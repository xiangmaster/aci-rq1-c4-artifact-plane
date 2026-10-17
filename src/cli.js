#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { audit } from "./index.js";

const [configPath, schemaPath] = process.argv.slice(2);
if (!configPath || !schemaPath) {
  console.error("usage: config-audit <config.json> <schema.json>");
  process.exit(2);
}

const result = audit(
  JSON.parse(readFileSync(configPath, "utf8")),
  JSON.parse(readFileSync(schemaPath, "utf8")),
);

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
