// Medication status lifecycle + synonym rows.
//
// Inputs, all committed (so both families rebuild byte-for-byte in CI):
//   sources/hl7-fhir-r4/codesystem-*.json          pinned FHIR R4 CodeSystems (CC0)
//   sources/cascade-curation/medication_status_lifecycle.json   code -> class
//   sources/cascade-curation/medication_status_synonyms.json    text -> code
//
// The FHIR snapshots are the authority for which codes exist and what they are
// called: every emitted code is looked up there and its display is FHIR's, not
// the seed's. Every check below throws rather than dropping a row, because a
// status table with a silent hole reads the missing status as "unknown", which
// is a wrong answer that looks like a cautious one.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SOURCES_DIR } from "./paths.mjs";
import { provenance } from "./provenance.mjs";

export const FHIR_DIR = join(SOURCES_DIR, "hl7-fhir-r4");
const SEED_DIR = join(SOURCES_DIR, "cascade-curation");

// Row system tag -> pinned CodeSystem file. The canonical URL each file must
// carry is checked on load, so a mislabelled snapshot cannot pass.
export const FHIR_CODE_SYSTEMS = {
  "FHIR-MEDICATIONREQUEST-STATUS": {
    file: "codesystem-medicationrequest-status.json",
    url: "http://hl7.org/fhir/CodeSystem/medicationrequest-status",
  },
  "FHIR-MEDICATIONSTATEMENT-STATUS": {
    file: "codesystem-medication-statement-status.json",
    url: "http://hl7.org/fhir/CodeSystem/medication-statement-status",
  },
  "FHIR-DATA-ABSENT-REASON": {
    file: "codesystem-data-absent-reason.json",
    url: "http://terminology.hl7.org/CodeSystem/data-absent-reason",
  },
};

// The two medication status systems, in the order a synonym's target is
// resolved: MedicationStatement first, because it is the resource that states
// whether a medication is being taken; MedicationRequest for the two codes only
// it defines (cancelled, draft).
export const MED_STATUS_SYSTEMS = [
  "FHIR-MEDICATIONSTATEMENT-STATUS",
  "FHIR-MEDICATIONREQUEST-STATUS",
];

export const LIFECYCLE_CLASS_SYSTEM = "CASCADE-MED-LIFECYCLE";

// The normalized key every consumer matches on. Mirrored by the consumers'
// normalizers; the key is data-independent, so it is fixed here rather than
// stored per row.
export function statusKey(raw) {
  return String(raw).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function readSeed(name) {
  return JSON.parse(readFileSync(join(SEED_DIR, `${name}.json`), "utf8"));
}

// system tag -> Map(code -> display), walking nested concepts.
export function loadFhirIndex(dir = FHIR_DIR) {
  const index = {};
  for (const [system, { file, url }] of Object.entries(FHIR_CODE_SYSTEMS)) {
    const cs = JSON.parse(readFileSync(join(dir, file), "utf8"));
    if (cs.resourceType !== "CodeSystem" || cs.url !== url) {
      throw new Error(`${file}: expected CodeSystem ${url}, found ${cs.resourceType} ${cs.url}`);
    }
    const codes = new Map();
    const walk = (concepts) => {
      for (const c of concepts || []) {
        codes.set(c.code, c.display);
        walk(c.concept);
      }
    };
    walk(cs.concept);
    index[system] = codes;
  }
  return index;
}

function citationFor(system) {
  return provenance("hl7-fhir-r4", { method: "curated", evidenceTier: "candidate", citationKey: system }).citation;
}

// seed + FHIR index -> medication-status-lifecycle rows.
export function medicationStatusLifecycleRows(seed, fhir) {
  const classes = Object.keys(seed.classes);
  const rows = [];
  const seen = new Set();
  const classNode = (cls) => {
    if (!classes.includes(cls)) throw new Error(`lifecycle seed: unknown class "${cls}"`);
    return { system: LIFECYCLE_CLASS_SYSTEM, code: cls, display: cls };
  };
  for (const system of MED_STATUS_SYSTEMS) {
    for (const [code, display] of fhir[system]) {
      const entry = seed.statusCodes[code];
      if (!entry) throw new Error(`lifecycle seed: FHIR ${system} code "${code}" has no class`);
      seen.add(code);
      rows.push({
        subject: { system, code, display },
        predicate: "has_lifecycle",
        object: classNode(entry.class),
        provenance: provenance("hl7-fhir-r4", {
          method: "curated",
          evidenceTier: "candidate",
          citationKey: system,
        }),
      });
    }
  }
  for (const code of Object.keys(seed.statusCodes)) {
    if (!seen.has(code)) throw new Error(`lifecycle seed: "${code}" is not a FHIR R4 medication status code`);
  }
  const a = seed.absent;
  const absentDisplay = fhir[a.system]?.get(a.code);
  if (!absentDisplay) throw new Error(`lifecycle seed: absent rule names ${a.system} "${a.code}", which FHIR does not define`);
  rows.push({
    subject: { system: a.system, code: a.code, display: absentDisplay },
    predicate: "has_lifecycle",
    object: classNode(a.class),
    provenance: provenance("hl7-fhir-r4", {
      method: "curated",
      evidenceTier: "candidate",
      citationKey: a.system,
    }),
  });
  return rows;
}

// seed + FHIR index -> medication-status-synonym rows.
export function medicationStatusSynonymRows(seed, fhir) {
  const canonicalKeys = new Set();
  for (const system of MED_STATUS_SYSTEMS) {
    for (const code of fhir[system].keys()) canonicalKeys.add(statusKey(code).replace(/ /g, ""));
  }
  const rows = [];
  const seen = new Set();
  for (const r of seed.rows) {
    const key = statusKey(r.text);
    if (!key) throw new Error(`synonym seed: "${r.text}" normalizes to nothing`);
    const predicate = { synonym: "synonym_of", fragment: "fragment_of" }[r.match];
    if (!predicate) throw new Error(`synonym seed: "${r.text}" has unknown match mode "${r.match}"`);
    // A whole-string synonym equal to a canonical code would never be reached
    // (the code matches first) and would read as if it could override it.
    if (predicate === "synonym_of" && canonicalKeys.has(key.replace(/ /g, ""))) {
      throw new Error(`synonym seed: "${r.text}" is already a FHIR status code`);
    }
    const dedupe = `${predicate}|${key.replace(/ /g, "")}`;
    if (seen.has(dedupe)) throw new Error(`synonym seed: "${r.text}" (${r.match}) is listed twice`);
    seen.add(dedupe);
    const system = MED_STATUS_SYSTEMS.find((s) => fhir[s].has(r.status));
    if (!system) throw new Error(`synonym seed: "${r.text}" targets "${r.status}", not a FHIR R4 medication status code`);
    rows.push({
      subject: { system: "text", display: r.text },
      predicate,
      object: { system, code: r.status, display: fhir[system].get(r.status) },
      provenance: provenance("cascade-curation", {
        method: "curated",
        evidenceTier: "candidate",
        citation: citationFor(system),
      }),
    });
  }
  return rows;
}
