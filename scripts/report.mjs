import { readFile, writeFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const report = {
  name: pkg.name,
  version: pkg.version,
  generated_at: new Date().toISOString(),
  run_id: process.env.GITHUB_RUN_ID ?? null,
  environment: process.env.GITHUB_ACTIONS ? "actions" : "local",
};

await writeFile("audit-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
