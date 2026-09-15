// Single source of truth for the v0 data families.
//
// Used by the schema generator, the build/migration pipelines, and the
// validators. A "family" is one relation type published as one JSONL file
// under data/<name>.jsonl. Every row shares the same canonical shape:
//
//   { subject:{system,code?,display}, predicate, object:{system,code?,display},
//     provenance:{source,sourceVersion,method,evidenceTier,citation,
//                 addedDate,reviewedDate} }
//
// The `subjectSystems` / `objectSystems` allowlists per family are the
// structural enforcement of the open-source wall: a SNOMED-CT (or any walled)
// code cannot validate against any family, so it cannot be committed.

// Code systems that may appear in committed rows. "text" is the pseudo-system
// used for free-text lay-language subjects (which carry no code).
export const OPEN_CODE_SYSTEMS = [
  "LOINC",
  // A LOINC Group identifier (LG...) is NOT a LOINC code: it names a collection
  // of codes, which FHIR models as a ValueSet rather than a CodeSystem concept.
  // It ships under the same LOINC license and under its own system id so that
  // the code-existence check does not look for an LG id in a code lookup.
  "LOINC-GROUP",
  "ICD-10-CM",
  "RXNORM",
  "MESH",
  "MED-RT",
  "CVX",
  "text",
];

// Systems that are license-walled and must NEVER reach committed data. Listed
// explicitly so the allowlist validator can give a precise wall-violation error.
export const WALLED_CODE_SYSTEMS = [
  "SNOMED-CT",
  "ATC",
  "CUI",
  "UMLS",
  "NDF-RT",
];

export const FAMILIES = [
  {
    name: "lab-condition",
    title: "Lab observation monitors / screens for / diagnoses a condition",
    predicates: ["monitors", "screens_for", "diagnoses"],
    subjectSystems: ["LOINC"],
    objectSystems: ["ICD-10-CM"],
    subjectCodeRequired: true,
    objectCodeRequired: true,
  },
  {
    name: "condition-synonym",
    title: "Lay-language term is a synonym of a coded condition",
    predicates: ["synonym_of"],
    subjectSystems: ["text"],
    objectSystems: ["ICD-10-CM"],
    subjectCodeRequired: false,
    objectCodeRequired: true,
  },
  {
    name: "condition-progression",
    title: "Condition may progress to / is a risk factor for / is a complication of a condition",
    predicates: ["may_progress_to", "risk_factor_for", "complication_of"],
    subjectSystems: ["ICD-10-CM"],
    objectSystems: ["ICD-10-CM"],
    subjectCodeRequired: true,
    objectCodeRequired: true,
  },
  {
    name: "drug-condition",
    title: "Drug may treat / may prevent a condition",
    predicates: ["may_treat", "may_prevent"],
    subjectSystems: ["RXNORM", "MED-RT"],
    objectSystems: ["MESH", "MED-RT"],
    subjectCodeRequired: true,
    objectCodeRequired: true,
  },
  {
    name: "brand-generic",
    title: "Brand name is a tradename of a generic ingredient",
    predicates: ["tradename_of"],
    subjectSystems: ["RXNORM"],
    objectSystems: ["RXNORM"],
    subjectCodeRequired: true,
    objectCodeRequired: true,
  },
  {
    name: "ingredient-rollup",
    title: "Drug product contains an ingredient",
    predicates: ["has_ingredient"],
    subjectSystems: ["RXNORM"],
    objectSystems: ["RXNORM"],
    subjectCodeRequired: true,
    objectCodeRequired: true,
  },
  {
    name: "lab-panel",
    title: "LOINC lab panel has a member observation",
    predicates: ["has_member"],
    subjectSystems: ["LOINC"],
    objectSystems: ["LOINC"],
    subjectCodeRequired: true,
    objectCodeRequired: true,
  },
  {
    name: "lab-group",
    title: "LOINC Group groups an observation",
    predicates: ["groups"],
    subjectSystems: ["LOINC-GROUP"],
    objectSystems: ["LOINC"],
    subjectCodeRequired: true,
    objectCodeRequired: true,
  },
  {
    name: "cvx-disease",
    title: "Vaccine (CVX) prevents a disease",
    predicates: ["prevents"],
    subjectSystems: ["CVX"],
    objectSystems: ["ICD-10-CM"],
    subjectCodeRequired: true,
    objectCodeRequired: true,
  },
];

export const FAMILY_BY_NAME = Object.fromEntries(
  FAMILIES.map((f) => [f.name, f]),
);

// The second artifact kind: per-code term tables under terms/, not relations.
//
// A term row is attributes OF one code, so it does not fit the relation shape
// and FAMILIES is deliberately not overloaded to carry it. One schema serves
// every term table; the tables differ only in which slice of the source they
// carry. Provenance is file-level (a sibling <name>.meta.json), because one
// source and one version are uniform across every row and repeating the block
// per row costs megabytes to say the same thing.
export const TERM_TABLES = [
  {
    name: "loinc-term",
    title: "LOINC term: one code with its licensed display names and attributes",
    systems: ["LOINC"],
    // Which LOINC field term.display was taken from. Section 10(c) of the LOINC
    // license accepts only these four names; the Consumer Name is not among
    // them, which is why it lives in the loinc block and never in display.
    displayFields: [
      "LONG_COMMON_NAME",
      "SHORTNAME",
      "DisplayName",
      "FULLY_SPECIFIED_NAME",
    ],
    // Exactly the columns the loinc block carries, in this order. Loinc.csv has
    // 40 columns; emitting all of them would be byte-equal to the release, would
    // pass every check here, and would produce an artifact several times the
    // intended size. ConsumerName comes from ConsumerName.csv, not Loinc.csv.
    loincColumns: [
      "LONG_COMMON_NAME",
      "SHORTNAME",
      "DisplayName",
      "CLASS",
      "CLASSTYPE",
      "STATUS",
      "EXAMPLE_UCUM_UNITS",
      "COMMON_TEST_RANK",
      "COMMON_ORDER_RANK",
      "EXTERNAL_COPYRIGHT_NOTICE",
      "EXTERNAL_COPYRIGHT_LINK",
      "ConsumerName",
    ],
    files: ["loinc-lab", "loinc-clinical"],
  },
];

export const TERM_TABLE_BY_NAME = Object.fromEntries(
  TERM_TABLES.map((t) => [t.name, t]),
);
