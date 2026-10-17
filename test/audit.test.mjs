import assert from "node:assert/strict";
import test from "node:test";

import { audit, checkValue, normalizeRules } from "../src/index.js";

test("accepts a valid config", () => {
  const result = audit({ region: "eu-west-1", replicas: 3 }, {
    region: { required: true, type: "string" },
    replicas: { type: "number" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.findings.length, 0);
});

test("flags missing required values as errors", () => {
  const result = audit({}, { region: { required: true, type: "string" } });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].severity, "error");
});

test("flags unknown fields as warnings", () => {
  const result = audit({ region: "eu", extra: true }, { region: { type: "string" } });
  assert.equal(result.ok, true);
  assert.equal(result.findings[0].message, "unknown field");
});

test("enum and pattern rules", () => {
  assert.deepEqual(checkValue("b", { enum: ["a", "c"] }), ['value not in ["a","c"]']);
  assert.deepEqual(checkValue("nope", { pattern: "^v[0-9]+$" }), ["value does not match ^v[0-9]+$"]);
});

test("rejects unknown rule names", () => {
  assert.throws(() => normalizeRules({ a: { min: 1 } }), /unknown rule min/);
});

test("rejects non-object schema", () => {
  assert.throws(() => normalizeRules(null), /schema must be an object/);
});
