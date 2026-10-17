import { readFile } from "node:fs/promises";

const url = process.env.NOTIFY_URL;
if (!url) {
  console.log("NOTIFY_URL is not configured; skipping");
  process.exit(0);
}

const body = await readFile(process.argv[2] || "summary/consumer-summary.json", "utf8");
const response = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});
console.log(`webhook responded ${response.status}`);
