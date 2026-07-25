// Runs every pipeline, then refreshes data/BUILD_MANIFEST.json.
//
// Pipelines whose inputs are absent (e.g. the licensed-adjacent MED-RT / RxNorm
// inputs in CI) are skipped, not failed. Their already-committed data files are
// left untouched. Locally, with all inputs present, this regenerates every file
// and the manifest.

import { InputMissingError } from "./lib/paths.mjs";
import { writeManifest } from "./lib/manifest.mjs";
import { run as buildCheckupCurated } from "./build/build-checkup-curated.mjs";
import { run as buildCvxDisease } from "./build/build-cvx-disease.mjs";
import { run as buildDrugConditionMedrt } from "./build/build-drug-condition-medrt.mjs";
import { run as buildRxnormPrescribable } from "./build/build-rxnorm-prescribable.mjs";
import { run as buildChvSynonyms } from "./build/build-chv-synonyms.mjs";

const PIPELINES = [
  { name: "checkup-curated", run: buildCheckupCurated },
  { name: "cvx-disease", run: buildCvxDisease },
  { name: "drug-condition-medrt", run: buildDrugConditionMedrt },
  { name: "rxnorm-prescribable", run: buildRxnormPrescribable },
  { name: "chv-synonyms", run: buildChvSynonyms },
];

export async function buildAll() {
  const results = {};
  const skipped = {};
  for (const p of PIPELINES) {
    try {
      results[p.name] = await p.run();
    } catch (e) {
      if (e instanceof InputMissingError || e.inputMissing) {
        skipped[p.name] = e.message;
      } else {
        throw e;
      }
    }
  }
  const manifest = writeManifest();
  return { results, skipped, manifestFiles: Object.keys(manifest.files).length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildAll().then((s) => console.log(JSON.stringify(s, null, 2)));
}
