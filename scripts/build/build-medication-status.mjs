// Pipeline: medication status lifecycle + synonyms.
//
// Every input is committed (the pinned FHIR R4 CodeSystem snapshots and the two
// curated seeds), so this pipeline is fully rebuildable in CI and
// determinism-checked in-process by validate-determinism.mjs.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeJsonl } from "../lib/canonical.mjs";
import { DATA_DIR } from "../lib/paths.mjs";
import {
  loadFhirIndex,
  readSeed,
  medicationStatusLifecycleRows,
  medicationStatusSynonymRows,
} from "../lib/medication-status.mjs";

export function run() {
  mkdirSync(DATA_DIR, { recursive: true });
  const fhir = loadFhirIndex();
  const lifecycle = medicationStatusLifecycleRows(readSeed("medication_status_lifecycle"), fhir);
  const synonyms = medicationStatusSynonymRows(readSeed("medication_status_synonyms"), fhir);
  return {
    "medication-status-lifecycle": writeJsonl(join(DATA_DIR, "medication-status-lifecycle.jsonl"), lifecycle),
    "medication-status-synonym": writeJsonl(join(DATA_DIR, "medication-status-synonym.jsonl"), synonyms),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(run(), null, 2));
}
