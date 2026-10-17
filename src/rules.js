const RULE_TYPES = new Set(["required", "type", "enum", "pattern"]);

export function normalizeRules(schema) {
  if (!schema || typeof schema !== "object") {
    throw new Error("schema must be an object");
  }
  return Object.entries(schema).map(([field, raw]) => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`rule for ${field} must be an object`);
    }
    for (const key of Object.keys(raw)) {
      if (!RULE_TYPES.has(key)) {
        throw new Error(`unknown rule ${key} for ${field}`);
      }
    }
    return [field, raw];
  });
}

export function checkValue(value, rule) {
  const issues = [];
  if (value === undefined) {
    if (rule.required) issues.push("missing required value");
    return issues;
  }
  if (rule.type && typeof value !== rule.type) {
    issues.push(`expected ${rule.type}, received ${typeof value}`);
  }
  if (rule.enum && !rule.enum.includes(value)) {
    issues.push(`value not in ${JSON.stringify(rule.enum)}`);
  }
  if (rule.pattern && typeof value === "string" && !new RegExp(rule.pattern).test(value)) {
    issues.push(`value does not match ${rule.pattern}`);
  }
  return issues;
}
