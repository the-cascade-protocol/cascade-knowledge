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
