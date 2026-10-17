import { checkValue, normalizeRules } from "./rules.js";

export function audit(config, schema) {
  if (!config || typeof config !== "object") {
    throw new Error("config must be an object");
  }
  const findings = [];
  for (const [field, rule] of normalizeRules(schema)) {
    for (const message of checkValue(config[field], rule)) {
      findings.push({ field, severity: rule.required ? "error" : "warning", message });
    }
  }
  const known = new Set(Object.keys(schema));
  for (const field of Object.keys(config)) {
    if (!known.has(field)) {
      findings.push({ field, severity: "warning", message: "unknown field" });
    }
  }
  return { ok: findings.every((finding) => finding.severity !== "error"), findings };
}

export { checkValue, normalizeRules } from "./rules.js";
