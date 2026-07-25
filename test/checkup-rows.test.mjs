import { test } from "node:test";
import assert from "node:assert/strict";
import {
  labConditionRows,
  conditionSynonymRows,
  conditionProgressionRows,
  cvxDiseaseRows,
  normalizeIcd10System,
} from "../scripts/lib/checkup-rows.mjs";

test("normalizeIcd10System maps ICD10 -> ICD-10-CM", () => {
  assert.equal(normalizeIcd10System("ICD10"), "ICD-10-CM");
  assert.equal(normalizeIcd10System("ICD10CM"), "ICD-10-CM");
  assert.equal(normalizeIcd10System(null), "ICD-10-CM");
});

test("labConditionRows builds LOINC->ICD-10 with LOINC citation and curated provenance", () => {
  const rows = labConditionRows([
    { loincCode: "2345-7", loincName: "Glucose", conditionIcd10: "E11", conditionName: "T2DM", relationship: "monitors" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject.system, "LOINC");
  assert.equal(rows[0].object.system, "ICD-10-CM");
  assert.equal(rows[0].predicate, "monitors");
  assert.equal(rows[0].provenance.method, "curated");
  assert.match(rows[0].provenance.citation, /loinc\.org/);
  // fixed-date constant, not wall-clock
  assert.match(rows[0].provenance.addedDate, /^\d{4}-\d{2}-\d{2}$/);
});

test("conditionSynonymRows makes a text subject and drops rows without a code", () => {
  const rows = conditionSynonymRows([
    { canonicalTerm: "hypertension", synonym: "high bp", codeSystem: "ICD10", code: "I10" },
    { canonicalTerm: "x", synonym: "y", codeSystem: "ICD10", code: "" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject.system, "text");
  assert.equal(rows[0].subject.code, undefined);
  assert.equal(rows[0].object.code, "I10");
});

test("conditionProgressionRows maps clinical evidence strength to the tier", () => {
  const rows = conditionProgressionRows([
    { sourceIcd10: "R73.03", sourceName: "Prediabetes", targetIcd10: "E11", targetName: "T2DM", relationship: "may_progress_to", evidence: "established" },
    { sourceIcd10: "A", sourceName: "a", targetIcd10: "B", targetName: "b", relationship: "risk_factor_for", evidence: "common" },
  ]);
  assert.equal(rows.find((r) => r.subject.code === "R73.03").provenance.evidenceTier, "established");
  assert.equal(rows.find((r) => r.subject.code === "A").provenance.evidenceTier, "candidate");
});

test("cvxDiseaseRows uses the CDC display and drops codes absent from CDC", () => {
  const idx = new Map([["03", { display: "MMR" }]]);
  const { rows, dropped } = cvxDiseaseRows(
    [
      { cvxCode: "03", diseaseIcd10: "B05", diseaseName: "Measles" },
      { cvxCode: "777", diseaseIcd10: "X", diseaseName: "Nope" },
    ],
    idx,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject.display, "MMR"); // CDC display, not the seed's
  assert.equal(rows[0].subject.system, "CVX");
  assert.deepEqual(dropped, ["777"]);
});
