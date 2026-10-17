import { readFile, writeFile } from "node:fs/promises";

const path = process.argv[2] || "incoming/audit-report.json";
const report = JSON.parse(await readFile(path, "utf8"));
const summary = {
  package: `${report.name}@${report.version}`,
  generated_at: report.generated_at,
  consumer: "artifact-consume",
  fields: Object.keys(report),
  payload: report,
};

await writeFile("consumer-summary.json", `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
