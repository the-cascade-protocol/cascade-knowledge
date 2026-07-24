// Phase 1: one-time, license-triaged migration of Cascade Checkup's curated
// crosswalk tables OUT of the app's clinical_knowledge.sqlite and INTO this
// repo as committed, license-clean seed files (sources/checkup-curation/*.json).
//
// Reads the sqlite READ-ONLY (sqlite3 CLI -readonly) at $CHECKUP_DB. Column
// names in that DB drift from its docs, so this reads the ACTUAL columns
// confirmed by `.schema`. It then invokes the shared builders to emit the
// schema-conformant JSONL, so a single run performs the migration end to end.
//
// License triage (verdicts in SOURCES.md):
//   loinc_condition_map    -> seed + data/lab-condition.jsonl          (LOINC + ICD-10-CM, open)
//   medical_synonyms       -> seed + data/condition-synonym.jsonl      (ICD-10-CM, public domain)
//   condition_progressions -> seed + data/condition-progression.jsonl  (ICD-10-CM, public domain)
//   cvx_disease_map        -> seed (built into cvx-disease by the CVX pipeline; CVX + ICD-10-CM, open)
//   icd10_snomed_crosswalk -> WALLED (SNOMED). Never emitted; counted only; routed to overlay/ docs.
//   drug_class_allergens   -> WALLED (SNOMED). Never emitted; counted only.
//   drugs/brand_*/product_*/pricing/... -> UMLS-derived. Never migrated (Phase 2 regenerates).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { INPUTS, requireInput, SOURCES_DIR } from "./lib/paths.mjs";
import { run as buildCheckupCurated } from "./build/build-checkup-curated.mjs";

const SEED_DIR = join(SOURCES_DIR, "checkup-curation");

function query(dbPath, sql) {
  const out = execFileSync("sqlite3", ["-readonly", "-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
  return out ? JSON.parse(out) : [];
}

// Write a seed file: rows sorted deterministically (by canonical JSON) and
// pretty-printed for readable diffs.
function writeSeed(name, rows) {
  const sorted = [...rows].sort((a, b) =>
    JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0,
  );
  writeFileSync(join(SEED_DIR, `${name}.json`), JSON.stringify(sorted, null, 2) + "\n");
  return sorted.length;
}

export function extractSeeds() {
  const db = requireInput(INPUTS.checkupDb, "Checkup clinical_knowledge.sqlite ($CHECKUP_DB)");
  mkdirSync(SEED_DIR, { recursive: true });
  const counts = {};

  counts.loinc_condition_map = writeSeed(
    "loinc_condition_map",
    query(db, "SELECT loincCode, loincName, conditionIcd10, conditionName, relationship FROM loinc_condition_map"),
  );
  counts.medical_synonyms = writeSeed(
    "medical_synonyms",
    query(db, "SELECT canonicalTerm, synonym, codeSystem, code FROM medical_synonyms"),
  );
  counts.condition_progressions = writeSeed(
    "condition_progressions",
    query(db, "SELECT sourceIcd10, sourceName, targetIcd10, targetName, relationship, evidence FROM condition_progressions"),
  );
  counts.cvx_disease_map = writeSeed(
    "cvx_disease_map",
    query(db, "SELECT cvxCode, vaccineName, diseaseIcd10, diseaseName FROM cvx_disease_map"),
  );

  // Walled tables: count for the report only, never emit.
  const walled = {};
  for (const t of ["icd10_snomed_crosswalk", "drug_class_allergens"]) {
    try {
      walled[t] = query(db, `SELECT COUNT(*) AS n FROM ${t}`)[0]?.n ?? 0;
    } catch {
      walled[t] = null;
    }
  }

  return { seeds: counts, walledNotEmitted: walled };
}

export function run() {
  const extract = extractSeeds();
  const built = buildCheckupCurated();
  return { ...extract, emitted: built };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(run(), null, 2));
}
