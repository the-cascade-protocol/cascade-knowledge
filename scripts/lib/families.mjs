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
  // FHIR R4 code systems (CC0). Each is the system of one required status
  // binding; the codes are checked against the pinned CodeSystem snapshots in
  // sources/hl7-fhir-r4/ at build time and against hl7.org by code-existence.
  "FHIR-MEDICATIONREQUEST-STATUS",
  "FHIR-MEDICATIONSTATEMENT-STATUS",
  "FHIR-DATA-ABSENT-REASON",
  // The five lifecycle classes of medication-status-lifecycle. Not a
  // terminology: a closed label set whose members the family schema enumerates
  // (objectCodes below), so a sixth class cannot be committed by accident.
  "CASCADE-MED-LIFECYCLE",
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
  {
    // "Is this medication still being taken?" One row per FHIR R4 status code
    // (MedicationRequest.status and MedicationStatement.status, both required
    // bindings) mapping it to one of five lifecycle classes, plus one row for an
    // ABSENT status, keyed on FHIR data-absent-reason "unknown": both status
    // elements are 1..1 in FHIR, so a record that carries none is a record
    // whose status is not known, never an implied "active".
    name: "medication-status-lifecycle",
    title: "Medication status code has a lifecycle class (active / stopped / paused / unknown / entered-in-error)",
    predicates: ["has_lifecycle"],
    subjectSystems: [
      "FHIR-MEDICATIONREQUEST-STATUS",
      "FHIR-MEDICATIONSTATEMENT-STATUS",
      "FHIR-DATA-ABSENT-REASON",
    ],
    objectSystems: ["CASCADE-MED-LIFECYCLE"],
    objectCodes: ["active", "stopped", "paused", "unknown", "entered-in-error"],
    subjectCodeRequired: true,
    objectCodeRequired: true,
  },
  {
    // Non-canonical status strings that real sources and extractors emit
    // ("discontinued", "d/c", "held", "no longer taking"), each mapped to the
    // FHIR status code it means. Its lifecycle class is then the canonical
    // code's row in medication-status-lifecycle, so a synonym can never carry a
    // class of its own. Two predicates, because two match modes: synonym_of is
    // a whole-string match and fragment_of a contained-phrase match, both over
    // the normalized key (lower-case, non-alphanumerics to single spaces).
    name: "medication-status-synonym",
    title: "Free-text medication status is a synonym of (or contains a phrase meaning) a FHIR status code",
    predicates: ["synonym_of", "fragment_of"],
    subjectSystems: ["text"],
    objectSystems: ["FHIR-MEDICATIONREQUEST-STATUS", "FHIR-MEDICATIONSTATEMENT-STATUS"],
    subjectCodeRequired: false,
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
    // Only fields that EXIST as columns in Loinc.csv, so the byte-equality check
    // can actually compare the display against its named source. The license
    // also accepts the fully specified name, but that is assembled from six
    // columns rather than carried as one, so a row claiming it could not be
    // checked and an unverifiable enum value is worse than a missing one. Add it
    // back the day the builder can emit and verify it.
    displayFields: ["LONG_COMMON_NAME", "SHORTNAME", "DisplayName"],
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
