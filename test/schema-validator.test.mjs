import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../scripts/lib/schema-validator.mjs";

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");
const labSchema = join(SCHEMA_DIR, "lab-condition.schema.json");

const good = {
  subject: { system: "LOINC", code: "2345-7", display: "Glucose" },
  predicate: "monitors",
  object: { system: "ICD-10-CM", code: "E11", display: "Type 2 diabetes" },
  provenance: {
    source: "checkup-curation",
    sourceVersion: "2026-02",
    method: "curated",
    evidenceTier: "established",
    citation: "https://loinc.org/",
    addedDate: "2026-07-24",
    reviewedDate: "2026-07-24",
  },
};

test("valid lab-condition row passes", () => {
  assert.deepEqual(validate(good, labSchema), []);
});

test("walled subject system (SNOMED-CT) fails the schema enum", () => {
  const bad = structuredClone(good);
  bad.subject.system = "SNOMED-CT";
  assert.ok(validate(bad, labSchema).some((e) => e.includes("subject/system")));
});

test("bad predicate fails", () => {
  const bad = structuredClone(good);
  bad.predicate = "cures";
  assert.ok(validate(bad, labSchema).length > 0);
});

test("non-ISO addedDate fails the pattern", () => {
  const bad = structuredClone(good);
  bad.provenance.addedDate = "2026/07/24";
  assert.ok(validate(bad, labSchema).some((e) => e.includes("addedDate")));
});

test("additional property is rejected", () => {
  const bad = structuredClone(good);
  bad.extra = 1;
  assert.ok(validate(bad, labSchema).some((e) => e.includes("additional property")));
});

test("missing required code fails when code is required", () => {
  const bad = structuredClone(good);
  delete bad.subject.code;
  assert.ok(validate(bad, labSchema).some((e) => e.includes("code")));
});

test("condition-synonym allows a text subject with no code", () => {
  const s = join(SCHEMA_DIR, "condition-synonym.schema.json");
  const row = {
    subject: { system: "text", display: "high blood pressure" },
    predicate: "synonym_of",
    object: { system: "ICD-10-CM", code: "I10", display: "hypertension" },
    provenance: good.provenance,
  };
  assert.deepEqual(validate(row, s), []);
});
