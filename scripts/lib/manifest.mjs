// Build manifest: per-data-file sha256 + row count + producing pipeline +
// whether the pipeline is rebuildable in CI (i.e. all its inputs are committed).
// The committed manifest is the integrity + determinism reference for CI.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FAMILIES } from "./families.mjs";
import { DATA_DIR } from "./paths.mjs";
import { SOURCE_VERSIONS } from "./provenance.mjs";

export const MANIFEST_PATH = join(DATA_DIR, "BUILD_MANIFEST.json");

// family -> { pipeline, ciRebuildable }. ciRebuildable is true when every input
// the pipeline reads is committed to this repo (so CI can rebuild and byte-diff).
export const FAMILY_PIPELINE = {
  "lab-condition": { pipeline: "checkup-curated", ciRebuildable: true },
  "condition-synonym": { pipeline: "checkup-curated", ciRebuildable: true },
  "condition-progression": { pipeline: "checkup-curated", ciRebuildable: true },
  "cvx-disease": { pipeline: "cvx-disease", ciRebuildable: true },
  "drug-condition": { pipeline: "drug-condition-medrt", ciRebuildable: false },
  "brand-generic": { pipeline: "rxnorm-prescribable", ciRebuildable: false },
  "ingredient-rollup": { pipeline: "rxnorm-prescribable", ciRebuildable: false },
};

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function countLines(path) {
  const text = readFileSync(path, "utf8");
  if (!text) return 0;
  return text.split("\n").filter((l) => l.trim()).length;
}

export function computeManifest() {
  const files = {};
  for (const f of FAMILIES) {
    const p = join(DATA_DIR, `${f.name}.jsonl`);
    if (!existsSync(p)) continue;
    const meta = FAMILY_PIPELINE[f.name] || { pipeline: "unknown", ciRebuildable: false };
    files[`${f.name}.jsonl`] = {
      rows: countLines(p),
      sha256: sha256File(p),
      pipeline: meta.pipeline,
      ciRebuildable: meta.ciRebuildable,
    };
  }
  return {
    _comment:
      "Integrity + determinism reference. sha256 is over the committed JSONL bytes. ciRebuildable pipelines are rebuilt-and-diffed in CI; others are checksum-verified in CI and fully rebuilt locally and in the scheduled regeneration workflow.",
    sourceVersions: SOURCE_VERSIONS,
    files,
  };
}

export function writeManifest() {
  const m = computeManifest();
  writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2) + "\n");
  return m;
}

export function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}
