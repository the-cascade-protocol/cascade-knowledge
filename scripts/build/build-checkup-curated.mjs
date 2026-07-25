// Deterministic build of the migrated Checkup curated families from the
// COMMITTED seeds (sources/checkup-curation/*.json). Needs no sqlite and no
// external input, so it is fully rebuildable in CI and covered by the
// determinism check.

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { writeJsonl } from "../lib/canonical.mjs";
import { DATA_DIR, SOURCES_DIR, InputMissingError } from "../lib/paths.mjs";
import {
  labConditionRows,
  conditionSynonymRows,
  conditionProgressionRows,
} from "../lib/checkup-rows.mjs";

const SEED_DIR = join(SOURCES_DIR, "checkup-curation");

function readSeed(name) {
  const p = join(SEED_DIR, `${name}.json`);
  if (!existsSync(p)) throw new InputMissingError(`checkup seed ${name}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function run() {
  mkdirSync(DATA_DIR, { recursive: true });
  const out = {};
  out["lab-condition"] = writeJsonl(
    join(DATA_DIR, "lab-condition.jsonl"),
    labConditionRows(readSeed("loinc_condition_map")),
  );
  out["condition-synonym"] = writeJsonl(
    join(DATA_DIR, "condition-synonym.jsonl"),
    conditionSynonymRows(readSeed("medical_synonyms")),
  );
  out["condition-progression"] = writeJsonl(
    join(DATA_DIR, "condition-progression.jsonl"),
    conditionProgressionRows(readSeed("condition_progressions")),
  );
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(run(), null, 2));
}
