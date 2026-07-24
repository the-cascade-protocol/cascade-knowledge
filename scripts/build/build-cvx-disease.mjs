// Phase 2, pipeline 3: CVX-to-disease.
//
// The authoritative CVX code identity (code -> vaccine name, status) comes from
// the pinned CDC CVX flat file (US federal work, public domain), committed at
// sources/cdc-cvx/CVX.txt. CDC does not publish a CVX-to-ICD-10 disease linkage,
// so that linkage is our curated crosswalk (migrated from Checkup, CVX +
// ICD-10-CM both open), committed at sources/checkup-curation/cvx_disease_map.json.
//
// Every emitted row's CVX code is validated to exist in the CDC snapshot, and
// its display is taken from CDC (not the curated seed). Both inputs are
// committed, so this pipeline is fully rebuildable in CI and determinism-checked.

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { writeJsonl } from "../lib/canonical.mjs";
import { parseCvx } from "../lib/cvx.mjs";
import { cvxDiseaseRows } from "../lib/checkup-rows.mjs";
import { DATA_DIR, SOURCES_DIR, CDC_CVX_FILE, InputMissingError } from "../lib/paths.mjs";

const CVX_SEED = join(SOURCES_DIR, "checkup-curation", "cvx_disease_map.json");

export function run() {
  if (!existsSync(CDC_CVX_FILE)) throw new InputMissingError("pinned CDC CVX snapshot");
  if (!existsSync(CVX_SEED)) throw new InputMissingError("cvx_disease_map seed");
  mkdirSync(DATA_DIR, { recursive: true });

  const cvxIndex = parseCvx(CDC_CVX_FILE);
  const seed = JSON.parse(readFileSync(CVX_SEED, "utf8"));
  const { rows, dropped } = cvxDiseaseRows(seed, cvxIndex);
  const count = writeJsonl(join(DATA_DIR, "cvx-disease.jsonl"), rows);
  const result = { "cvx-disease": count };
  if (dropped.length) result._droppedCvxNotInCdc = dropped;
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(run(), null, 2));
}
