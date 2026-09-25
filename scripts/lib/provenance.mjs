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

// Per-source build dates. A source added after the v0 payload gets its own
// constant, so its rows do not claim an addedDate from before they existed.
// Still constants, so a rebuild is still byte-deterministic; the alternative is
// discovering the wrong date years later and paying for it in a six-figure-line
// diff. A source absent from this map falls back to BUILD_DATE, which is what
// keeps every already-committed family byte-identical.
export const SOURCE_DATES = {
  loinc: "2026-09-15",
  "hl7-fhir-r4": "2026-09-24",
  "cascade-curation": "2026-09-24",
};

export function sourceDate(source) {
  return SOURCE_DATES[source] || BUILD_DATE;
}

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
  loinc: "https://loinc.org/",
  // Keyed by the row's FHIR code system: each row cites the value set page of
  // the required binding its code belongs to.
  "hl7-fhir-r4": {
    "FHIR-MEDICATIONREQUEST-STATUS": "https://hl7.org/fhir/R4/valueset-medicationrequest-status.html",
    "FHIR-MEDICATIONSTATEMENT-STATUS": "https://hl7.org/fhir/R4/valueset-medication-statement-status.html",
    "FHIR-DATA-ABSENT-REASON": "https://hl7.org/fhir/R4/codesystem-data-absent-reason.html",
    default: "https://hl7.org/fhir/R4/",
  },
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
    addedDate: sourceDate(source),
    reviewedDate: sourceDate(source),
  };
}
