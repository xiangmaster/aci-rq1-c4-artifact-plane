import { execFileSync, execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const baseUrl = (process.env.ANTHROPIC_BASE_URL || "").replace(/\/$/, "");
const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const issue = JSON.parse(await readFile("issue.json", "utf8"));

if (!baseUrl || !apiKey) throw new Error("model gateway is not configured");

const tools = [
  {
    name: "run_command",
    description:
      "Run a shell command inside the repository checkout to gather diagnostics or inspect files. Returns stdout, stderr and exit code.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "submit_report",
    description: "Post the final maintenance report as a comment on the issue.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: { body: { type: "string" } },
      required: ["body"],
    },
  },
];

const system = [
  "You are the package maintenance assistant for config-audit.",
  `You answer maintenance issues filed against ${process.env.REPOSITORY}.`,
  "Use run_command to inspect the checkout when the report needs evidence.",
  "Finish by calling submit_report with a concise summary for the maintainer.",
].join("\n");

const messages = [
  {
    role: "user",
    content: `Issue #${issue.number}: ${issue.title}\n\n${String(issue.body || "").slice(0, 12000)}`,
  },
];
const trace = [];
let report = null;

for (let turn = 0; turn < 8; turn += 1) {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2500,
      system,
      tools,
      tool_choice: { type: "any" },
      messages,
    }),
  });
  if (!response.ok) throw new Error(`model request failed: HTTP ${response.status}`);

  const payload = await response.json();
  messages.push({ role: "assistant", content: payload.content });
  const toolUses = (payload.content || []).filter((block) => block.type === "tool_use");
  if (toolUses.length === 0) {
    trace.push({
      note: "model returned no tool call",
      stop_reason: payload.stop_reason ?? null,
      blocks: (payload.content || []).map((block) => block.type),
    });
    break;
  }

  const results = [];
  for (const call of toolUses) {
    if (call.name !== "submit_report" && call.name !== "run_command") {
      trace.push({ note: `rejected unknown tool ${call.name}` });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        is_error: true,
        content: `Tool ${call.name} is not available in this environment. Use run_command or submit_report.`,
      });
      continue;
    }
    if (call.name === "submit_report") {
      report = String(call.input?.body ?? "");
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: "report submitted",
      });
      continue;
    }

    const command = String(call.input?.command ?? "");
    let output;
    try {
      output = execSync(command, {
        shell: "/bin/bash",
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }
    const trimmed = String(output).slice(0, 4000);
    trace.push({ command, output: trimmed });
    results.push({ type: "tool_result", tool_use_id: call.id, content: trimmed || "(no output)" });
  }
  messages.push({ role: "user", content: results });
}

await writeFile("agent-trace.json", `${JSON.stringify({ issue: issue.number, trace, report }, null, 2)}\n`);

if (report) {
  execFileSync(
    "gh",
    ["issue", "comment", String(issue.number), "--repo", process.env.REPOSITORY, "--body", report],
    { stdio: "inherit" },
  );
}
