import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonl, serializeJsonl } from "../scripts/lib/canonical.mjs";
import {
  loadFhirIndex,
  readSeed,
  statusKey,
  medicationStatusLifecycleRows,
  medicationStatusSynonymRows,
  MED_STATUS_SYSTEMS,
} from "../scripts/lib/medication-status.mjs";
import { readFileSync } from "node:fs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const lifecycle = readJsonl(join(REPO, "data", "medication-status-lifecycle.jsonl"));
const synonyms = readJsonl(join(REPO, "data", "medication-status-synonym.jsonl"));
const fhir = loadFhirIndex();

// status string -> class, over the two medication status systems.
const classOf = new Map();
for (const r of lifecycle) {
  if (MED_STATUS_SYSTEMS.includes(r.subject.system)) classOf.set(r.subject.code, r.object.code);
}

test("every FHIR R4 MedicationRequest.status and MedicationStatement.status code has exactly one row", () => {
  for (const system of MED_STATUS_SYSTEMS) {
    const rows = lifecycle.filter((r) => r.subject.system === system);
    assert.deepEqual(
      rows.map((r) => r.subject.code).sort(),
      [...fhir[system].keys()].sort(),
      system,
    );
  }
});

test("a code in both value sets has the same class in both", () => {
  const seen = new Map();
  for (const r of lifecycle) {
    if (!MED_STATUS_SYSTEMS.includes(r.subject.system)) continue;
    const prior = seen.get(r.subject.code);
    if (prior) assert.equal(r.object.code, prior, r.subject.code);
    seen.set(r.subject.code, r.object.code);
  }
});

test("the classes are the published table (pinned so a reclassification is a visible diff)", () => {
  assert.deepEqual(Object.fromEntries([...classOf].sort()), {
    active: "active",
    cancelled: "stopped",
    completed: "stopped",
    draft: "unknown",
    "entered-in-error": "entered-in-error",
    intended: "unknown",
    "not-taken": "stopped",
    "on-hold": "unknown",
    stopped: "stopped",
    unknown: "unknown",
  });
});

test("the Cascade clinical vocabulary's intended medication status set is fully covered", () => {
  // clinical.ttl (spec, clinical v1) documents the INTENDED value set for
  // clinical:status on clinical:Medication as FHIR R4 MedicationRequest.status
  // and records that clinical:MedicationShape does not yet enforce it (no sh:in).
  const intended = ["active", "on-hold", "cancelled", "completed", "entered-in-error", "stopped", "draft", "unknown"];
  for (const code of intended) assert.ok(classOf.has(code), code);
});

test("an absent status is data: FHIR data-absent-reason 'unknown' has class unknown", () => {
  const absent = lifecycle.filter((r) => r.subject.system === "FHIR-DATA-ABSENT-REASON");
  assert.equal(absent.length, 1);
  assert.equal(absent[0].subject.code, "unknown");
  assert.equal(absent[0].object.code, "unknown");
});

test("every synonym resolves to a status code that has a class, and never shadows a code", () => {
  const codeKeys = new Set([...classOf.keys()].map((c) => statusKey(c).replace(/ /g, "")));
  for (const r of synonyms) {
    assert.ok(classOf.has(r.object.code), `${r.subject.display} -> ${r.object.code}`);
    if (r.predicate === "synonym_of") {
      assert.ok(!codeKeys.has(statusKey(r.subject.display).replace(/ /g, "")), r.subject.display);
    }
  }
});

test("every row is a candidate, with FHIR or Cascade curation provenance", () => {
  for (const r of [...lifecycle, ...synonyms]) {
    assert.equal(r.provenance.evidenceTier, "candidate");
    assert.equal(r.provenance.method, "curated");
    assert.ok(["hl7-fhir-r4", "cascade-curation"].includes(r.provenance.source));
    assert.match(r.provenance.citation, /^https:\/\/hl7\.org\/fhir\/R4\//);
  }
});

test("the build refuses a seed that leaves a FHIR code unclassified", () => {
  const seed = readSeed("medication_status_lifecycle");
  const holed = { ...seed, statusCodes: { ...seed.statusCodes } };
  delete holed.statusCodes["on-hold"];
  assert.throws(() => medicationStatusLifecycleRows(holed, fhir), /on-hold/);
});

test("the build refuses a seed entry FHIR does not define, and a class the seed does not declare", () => {
  const seed = readSeed("medication_status_lifecycle");
  assert.throws(
    () => medicationStatusLifecycleRows({ ...seed, statusCodes: { ...seed.statusCodes, discontinued: { class: "stopped" } } }, fhir),
    /discontinued/,
  );
  assert.throws(
    () => medicationStatusLifecycleRows({ ...seed, statusCodes: { ...seed.statusCodes, active: { class: "current" } } }, fhir),
    /current/,
  );
});

test("the build refuses a synonym whose target is not a FHIR status code", () => {
  assert.throws(
    () => medicationStatusSynonymRows({ rows: [{ text: "gone", match: "synonym", status: "discontinued" }] }, fhir),
    /discontinued/,
  );
});

test("both families rebuild byte-for-byte from the committed inputs", () => {
  const a = serializeJsonl(medicationStatusLifecycleRows(readSeed("medication_status_lifecycle"), fhir));
  const b = serializeJsonl(medicationStatusSynonymRows(readSeed("medication_status_synonyms"), fhir));
  assert.equal(a, readFileSync(join(REPO, "data", "medication-status-lifecycle.jsonl"), "utf8"));
  assert.equal(b, readFileSync(join(REPO, "data", "medication-status-synonym.jsonl"), "utf8"));
});
