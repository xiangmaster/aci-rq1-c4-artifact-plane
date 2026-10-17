import { execFileSync, execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const baseUrl = (process.env.ANTHROPIC_BASE_URL || "").replace(/\/$/, "");
const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const protocol = (process.env.MODEL_PROTOCOL || "anthropic").toLowerCase();
const issue = JSON.parse(await readFile("issue.json", "utf8"));

if (!baseUrl || !apiKey) {
  throw new Error("ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY are required");
}

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
  "You must call one of the provided tools on every turn.",
].join("\n");

const userContent = [
  `Issue #${issue.number}: ${issue.title}`,
  "",
  String(issue.body || "").slice(0, 12000),
].join("\n");

let messages = [{ role: "user", content: userContent }];
const trace = [];
let report = null;

function openaiTools() {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function parseArguments(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return { __invalid_arguments: String(raw), __error: String(error) };
  }
}

async function postOpenAI(body) {
  const request = async (payload) =>
    fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

  let response = await request(body);
  if (response.status === 400) {
    const text = await response.text();
    if (text.includes("max_tokens") && text.includes("max_completion_tokens")) {
      const retry = { ...body };
      retry.max_completion_tokens = retry.max_tokens;
      delete retry.max_tokens;
      response = await request(retry);
    } else {
      throw new Error(`model request failed: HTTP 400 ${text}`);
    }
  }
  if (!response.ok) {
    throw new Error(`model request failed: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function callOpenAI() {
  const payload = await postOpenAI({
    model,
    max_tokens: 2500,
    messages: [{ role: "system", content: system }, ...messages],
    tools: openaiTools(),
    tool_choice: "auto",
  });
  const message = payload.choices?.[0]?.message || {};
  const calls = message.tool_calls || [];
  return {
    kind: "openai",
    message,
    toolUses: calls.map((call) => ({
      id: call.id,
      name: call.function?.name,
      input: parseArguments(call.function?.arguments),
    })),
  };
}

async function callAnthropic() {
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
  if (!response.ok) {
    throw new Error(`model request failed: HTTP ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  const content = payload.content || [];
  return {
    kind: "anthropic",
    content,
    toolUses: content
      .filter((block) => block.type === "tool_use")
      .map((block) => ({ id: block.id, name: block.name, input: block.input })),
  };
}

for (let turn = 0; turn < 8; turn += 1) {
  const response = protocol === "openai" ? await callOpenAI() : await callAnthropic();

  if (response.kind === "openai") {
    messages.push({
      role: "assistant",
      content: response.message.content ?? null,
      tool_calls: response.message.tool_calls || [],
    });
  } else {
    messages.push({ role: "assistant", content: response.content });
  }

  if (response.toolUses.length === 0) {
    trace.push({ note: "model returned no tool call" });
    break;
  }

  const results = [];
  for (const call of response.toolUses) {
    if (call.name !== "submit_report" && call.name !== "run_command") {
      trace.push({ note: `rejected unknown tool ${call.name}` });
      results.push({
        id: call.id,
        content: `Tool ${call.name} is not available. Use run_command or submit_report.`,
        is_error: true,
      });
      continue;
    }

    if (call.name === "submit_report") {
      report = String(call.input?.body ?? "");
      trace.push({ action: "submit_report", bytes: Buffer.byteLength(report) });
      results.push({ id: call.id, content: "report submitted", is_error: false });
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
    results.push({ id: call.id, content: trimmed || "(no output)", is_error: false });
  }

  if (response.kind === "openai") {
    for (const result of results) {
      messages.push({
        role: "tool",
        tool_call_id: result.id,
        content: result.content,
      });
    }
  } else {
    messages.push({
      role: "user",
      content: results.map((result) => ({
        type: "tool_result",
        tool_use_id: result.id,
        content: result.content,
        is_error: result.is_error,
      })),
    });
  }
}

await writeFile(
  "agent-trace.json",
  `${JSON.stringify({ issue: issue.number, protocol, model, trace, report }, null, 2)}\n`,
);

if (report) {
  execFileSync(
    "gh",
    ["issue", "comment", String(issue.number), "--repo", process.env.REPOSITORY, "--body", report],
    { stdio: "inherit" },
  );
}
