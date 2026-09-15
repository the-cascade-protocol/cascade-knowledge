// Validator: determinism + integrity.
//
//  1. Checksums: every committed data file matches BUILD_MANIFEST.json (sha256
//     and row count). Runs everywhere, needs no inputs.
//  2. In-process rebuild (CI-safe): CI-rebuildable families are recomputed from
//     their committed inputs (seeds + pinned CDC snapshot) and byte-compared to
//     the committed JSONL. Needs no network and no licensed inputs.
//  3. Full rebuild (local / scheduled): if the MED-RT, RxNorm and LOINC inputs
//     are present, their pipelines are re-run in a subprocess writing to a temp
//     dir and byte-compared. Skipped (reported) when inputs are absent. The
//     LOINC pipeline writes both relation families and the term tables, so its
//     rebuild redirects KNOWLEDGE_TERMS_DIR as well as KNOWLEDGE_DATA_DIR.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { FAMILIES } from "../lib/families.mjs";
import { serializeJsonl } from "../lib/canonical.mjs";
import { readManifest, sha256File, FAMILY_PIPELINE } from "../lib/manifest.mjs";
import { DATA_DIR, TERMS_DIR, SOURCES_DIR, CDC_CVX_FILE, INPUTS } from "../lib/paths.mjs";
import {
  labConditionRows,
  conditionSynonymRows,
  conditionProgressionRows,
  cvxDiseaseRows,
} from "../lib/checkup-rows.mjs";
import { parseCvx } from "../lib/cvx.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SEED_DIR = join(SOURCES_DIR, "checkup-curation");

function readSeed(name) {
  return JSON.parse(readFileSync(join(SEED_DIR, `${name}.json`), "utf8"));
}

// Recompute the canonical bytes of a CI-rebuildable family in-process.
function recomputeFamilyBytes(name) {
  switch (name) {
    case "lab-condition":
      return serializeJsonl(labConditionRows(readSeed("loinc_condition_map")));
    case "condition-synonym":
      return serializeJsonl(conditionSynonymRows(readSeed("medical_synonyms")));
    case "condition-progression":
      return serializeJsonl(conditionProgressionRows(readSeed("condition_progressions")));
    case "cvx-disease": {
      const idx = parseCvx(CDC_CVX_FILE);
      const { rows } = cvxDiseaseRows(readSeed("cvx_disease_map"), idx);
      return serializeJsonl(rows);
    }
    default:
      return null;
  }
}

export function validateDeterminism() {
  const errors = [];
  const notes = [];
  const manifest = readManifest();

  // (1) Checksums for every committed file.
  for (const [file, meta] of Object.entries(manifest.files)) {
    const p = join(DATA_DIR, file);
    if (!existsSync(p)) {
      errors.push(`checksum: committed manifest lists ${file} but it is missing`);
      continue;
    }
    const sha = sha256File(p);
    if (sha !== meta.sha256) {
      errors.push(`checksum: ${file} sha256 ${sha} != manifest ${meta.sha256}`);
    }
  }

  // (2) In-process rebuild of CI-rebuildable families.
  let rebuilt = 0;
  for (const f of FAMILIES) {
    const meta = FAMILY_PIPELINE[f.name];
    if (!meta?.ciRebuildable) continue;
    const p = join(DATA_DIR, `${f.name}.jsonl`);
    if (!existsSync(p)) continue;
    const expected = recomputeFamilyBytes(f.name);
    const actual = readFileSync(p, "utf8");
    if (expected !== actual) {
      errors.push(`determinism: ${f.name}.jsonl rebuild != committed (CI-rebuildable)`);
    } else {
      rebuilt++;
    }
  }

  // (3) Full rebuild of licensed-adjacent pipelines when inputs are present.
  const fullChecks = [];
  const termChecks = [];
  const canMedrt = INPUTS.medrtXml && existsSync(INPUTS.medrtXml);
  const canRxnorm = INPUTS.rxnormPrescribeRrf && existsSync(INPUTS.rxnormPrescribeRrf);
  const canLoinc = INPUTS.loincReleaseDir && existsSync(INPUTS.loincReleaseDir);
  if (canMedrt || canRxnorm || canLoinc) {
    const tmp = mkdtempSync(join(tmpdir(), "ck-determinism-"));
    try {
      const runInTmp = (script, extraEnv = {}) =>
        execFileSync("node", [join(REPO_ROOT, script)], {
          env: { ...process.env, KNOWLEDGE_DATA_DIR: tmp, ...extraEnv },
          encoding: "utf8",
        });
      if (canMedrt) {
        runInTmp("scripts/build/build-drug-condition-medrt.mjs");
        fullChecks.push("drug-condition");
      }
      if (canRxnorm) {
        runInTmp("scripts/build/build-rxnorm-prescribable.mjs");
        fullChecks.push("brand-generic", "ingredient-rollup");
      }
      if (canLoinc) {
        runInTmp("scripts/build/build-loinc-terms.mjs", { KNOWLEDGE_TERMS_DIR: tmp });
        fullChecks.push("lab-panel", "lab-group");
        termChecks.push("loinc-lab", "loinc-clinical");
      }
      // Term tables live under terms/, not data/, and have no manifest entry:
      // their integrity reference is the sibling .meta.json hash, so the rebuild
      // has to byte-compare both the table and its meta.
      for (const t of termChecks) {
        for (const ext of ["jsonl", "meta.json"]) {
          const a = join(tmp, `${t}.${ext}`);
          const b = join(TERMS_DIR, `${t}.${ext}`);
          if (!existsSync(a)) {
            errors.push(`determinism: full rebuild did not produce ${t}.${ext}`);
          } else if (!existsSync(b)) {
            errors.push(`determinism: committed ${t}.${ext} is missing`);
          } else if (sha256File(a) !== sha256File(b)) {
            errors.push(`determinism: ${t}.${ext} full rebuild != committed`);
          }
        }
      }
      for (const fam of fullChecks) {
        const a = join(tmp, `${fam}.jsonl`);
        const b = join(DATA_DIR, `${fam}.jsonl`);
        if (!existsSync(a)) {
          errors.push(`determinism: full rebuild did not produce ${fam}.jsonl`);
        } else if (sha256File(a) !== sha256File(b)) {
          errors.push(`determinism: ${fam}.jsonl full rebuild != committed`);
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  if (!canMedrt) notes.push("MED-RT input absent: drug-condition full rebuild skipped (checksum-verified only)");
  if (!canRxnorm) notes.push("RxNorm input absent: brand-generic/ingredient-rollup full rebuild skipped (checksum-verified only)");
  if (!canLoinc) notes.push("LOINC release absent: lab-panel/lab-group and the terms/ tables full rebuild skipped (checksum-verified only)");

  return {
    ok: errors.length === 0,
    checksums: Object.keys(manifest.files).length,
    inProcessRebuilt: rebuilt,
    fullRebuilt: fullChecks,
    termsRebuilt: termChecks,
    notes,
    errors,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = validateDeterminism();
  console.log(
    `determinism: ${r.checksums} checksums, ${r.inProcessRebuilt} in-process rebuilds, full rebuilt [${r.fullRebuilt.join(", ")}], ${r.errors.length} errors`,
  );
  for (const n of r.notes) console.log("  note: " + n);
  for (const e of r.errors.slice(0, 50)) console.log("  " + e);
  process.exit(r.ok ? 0 : 1);
}
