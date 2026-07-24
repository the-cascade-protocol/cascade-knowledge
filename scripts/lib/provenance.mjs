// Provenance construction. All dates are FIXED CONSTANTS (never wall-clock), so
// regeneration is byte-deterministic.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

// The date the v0 payload was assembled. Used as addedDate/reviewedDate for the
// one-time migration and as addedDate for regenerated rows. A constant, so a
// rebuild produces identical bytes.
export const BUILD_DATE = "2026-07-24";

export const SOURCE_VERSIONS = JSON.parse(
  readFileSync(join(REPO_ROOT, "sources", "SOURCE_VERSIONS.json"), "utf8"),
);

// Canonical, resolvable citation per source. "citation" on each row points at
// the authority for the row's primary code system or the source release.
export const CITATIONS = {
  "checkup-curation": {
    LOINC: "https://loinc.org/",
    "ICD-10-CM": "https://www.cms.gov/medicare/coding-billing/icd-10-codes",
    CVX: "https://www2.cdc.gov/vaccines/iis/iisstandards/vaccines.asp?rpt=cvx",
    default: "https://www.cms.gov/medicare/coding-billing/icd-10-codes",
  },
  "med-rt": "https://www.nlm.nih.gov/research/umls/sourcereleasedocs/current/MED-RT/index.html",
  "rxnorm-prescribable": "https://www.nlm.nih.gov/research/umls/rxnorm/docs/prescribe.html",
  "cdc-cvx": "https://www2.cdc.gov/vaccines/iis/iisstandards/vaccines.asp?rpt=cvx",
};

// Build a provenance object. `source` selects the pinned version and default
// method; caller supplies evidenceTier, and optionally overrides method and the
// citation-selection key.
export function provenance(source, { method, evidenceTier, citation, citationKey } = {}) {
  const sourceVersion = SOURCE_VERSIONS[source];
  if (!sourceVersion) throw new Error(`no pinned version for source "${source}"`);
  let cite = citation;
  if (!cite) {
    const c = CITATIONS[source];
    cite = typeof c === "string" ? c : c[citationKey] || c.default;
  }
  if (!cite) throw new Error(`no citation for source "${source}"`);
  return {
    source,
    sourceVersion,
    method,
    evidenceTier,
    citation: cite,
    addedDate: BUILD_DATE,
    reviewedDate: BUILD_DATE,
  };
}
