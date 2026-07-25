import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeRow, serializeJsonl } from "../scripts/lib/canonical.mjs";

const prov = {
  source: "med-rt",
  sourceVersion: "2026.01.05",
  method: "derived",
  evidenceTier: "established",
  citation: "https://example.org/",
  addedDate: "2026-07-24",
  reviewedDate: "2026-07-24",
};

test("serializeRow uses a fixed key order regardless of input key order", () => {
  const a = {
    provenance: prov,
    object: { display: "d", code: "9000002", system: "MESH" },
    predicate: "may_treat",
    subject: { display: "s", system: "RXNORM", code: "9000001" },
  };
  const s = serializeRow(a);
  assert.equal(
    s,
    '{"subject":{"system":"RXNORM","code":"9000001","display":"s"},"predicate":"may_treat","object":{"system":"MESH","code":"9000002","display":"d"},"provenance":{"source":"med-rt","sourceVersion":"2026.01.05","method":"derived","evidenceTier":"established","citation":"https://example.org/","addedDate":"2026-07-24","reviewedDate":"2026-07-24"}}',
  );
});

test("absent code is omitted, never emitted as null", () => {
  const row = {
    subject: { system: "text", display: "high bp" },
    predicate: "synonym_of",
    object: { system: "ICD-10-CM", code: "I10", display: "hypertension" },
    provenance: prov,
  };
  const s = serializeRow(row);
  assert.ok(!s.includes('"code":null'));
  assert.ok(s.startsWith('{"subject":{"system":"text","display":"high bp"}'));
});

test("serializeJsonl sorts deterministically and de-duplicates", () => {
  const mk = (code) => ({
    subject: { system: "RXNORM", code, display: code },
    predicate: "may_treat",
    object: { system: "MESH", code: "M1", display: "x" },
    provenance: prov,
  });
  const out1 = serializeJsonl([mk("2"), mk("1"), mk("1")]);
  const out2 = serializeJsonl([mk("1"), mk("2")]);
  assert.equal(out1, out2); // order-independent
  assert.equal(out1.trim().split("\n").length, 2); // duplicate collapsed
});
