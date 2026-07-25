// Pure seed-row -> schema-row transforms shared by the one-time migration
// (sqlite -> committed seeds) and the deterministic build (committed seeds ->
// JSONL). Having ONE transform code path means the migration and the rebuild
// cannot drift. No wall-clock here; provenance dates come from constants.

import { provenance } from "./provenance.mjs";

const SOURCE = "checkup-curation";

export function normalizeIcd10System(codeSystem) {
  if (!codeSystem) return "ICD-10-CM";
  const c = String(codeSystem).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c === "ICD10" || c === "ICD10CM") return "ICD-10-CM";
  return codeSystem;
}

// loinc_condition_map -> lab-condition
export function labConditionRows(seed) {
  return seed.map((r) => ({
    subject: { system: "LOINC", code: r.loincCode, display: r.loincName },
    predicate: r.relationship,
    object: { system: "ICD-10-CM", code: r.conditionIcd10, display: r.conditionName },
    provenance: provenance(SOURCE, {
      method: "curated",
      evidenceTier: "established",
      citationKey: "LOINC",
    }),
  }));
}

// medical_synonyms -> condition-synonym (lay text -> ICD-10 condition)
export function conditionSynonymRows(seed) {
  return seed
    .filter((r) => r.code && r.synonym)
    .map((r) => ({
      subject: { system: "text", display: r.synonym },
      predicate: "synonym_of",
      object: {
        system: normalizeIcd10System(r.codeSystem),
        code: r.code,
        display: r.canonicalTerm,
      },
      provenance: provenance(SOURCE, {
        method: "curated",
        evidenceTier: "established",
        citationKey: "ICD-10-CM",
      }),
    }));
}

// condition_progressions -> condition-progression
export function conditionProgressionRows(seed) {
  return seed.map((r) => ({
    subject: { system: "ICD-10-CM", code: r.sourceIcd10, display: r.sourceName },
    predicate: r.relationship,
    object: { system: "ICD-10-CM", code: r.targetIcd10, display: r.targetName },
    provenance: provenance(SOURCE, {
      method: "curated",
      // The curated clinical "evidence" strength drives the tier: an explicit
      // "established" basis promotes the row; anything softer lands candidate.
      evidenceTier:
        String(r.evidence || "").toLowerCase() === "established" ? "established" : "candidate",
      citationKey: "ICD-10-CM",
    }),
  }));
}

// cvx_disease_map + CDC CVX index -> cvx-disease.
// cvxIndex: Map(cvxCode -> {display}). Rows whose CVX code is not present in the
// authoritative CDC snapshot are dropped (returned in `dropped`).
export function cvxDiseaseRows(seed, cvxIndex) {
  const rows = [];
  const dropped = [];
  for (const r of seed) {
    const code = String(r.cvxCode);
    const cdc = cvxIndex.get(code);
    if (!cdc) {
      dropped.push(code);
      continue;
    }
    rows.push({
      // Display comes from the authoritative CDC short description.
      subject: { system: "CVX", code, display: cdc.display },
      predicate: "prevents",
      object: { system: "ICD-10-CM", code: r.diseaseIcd10, display: r.diseaseName },
      provenance: provenance(SOURCE, {
        method: "curated",
        evidenceTier: "established",
        citationKey: "CVX",
      }),
    });
  }
  return { rows, dropped };
}
