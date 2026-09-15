// Generates schema/defs.schema.json and schema/<family>.schema.json from the
// single family definition in scripts/lib/families.mjs, so the shared row shape
// stays identical across families. Run: node scripts/gen-schemas.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FAMILIES, TERM_TABLES } from "./lib/families.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(HERE, "..", "schema");
const BASE_ID = "https://ns.cascadeprotocol.org/knowledge/v0";

const defs = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${BASE_ID}/defs.schema.json`,
  title: "Shared definitions for cascade-knowledge v0 rows",
  $defs: {
    node: {
      type: "object",
      additionalProperties: false,
      required: ["system", "display"],
      properties: {
        system: { type: "string", minLength: 1 },
        code: { type: "string", minLength: 1 },
        display: { type: "string", minLength: 1 },
      },
    },
    provenance: {
      type: "object",
      additionalProperties: false,
      required: [
        "source",
        "sourceVersion",
        "method",
        "evidenceTier",
        "citation",
        "addedDate",
        "reviewedDate",
      ],
      properties: {
        source: { type: "string", minLength: 1 },
        sourceVersion: { type: "string", minLength: 1 },
        method: { enum: ["curated", "derived"] },
        evidenceTier: { enum: ["candidate", "established"] },
        citation: { type: "string", pattern: "^https?://" },
        addedDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        reviewedDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      },
    },
  },
};

function nodeSchema(systems, codeRequired) {
  return {
    allOf: [
      { $ref: "defs.schema.json#/$defs/node" },
      {
        type: "object",
        required: codeRequired ? ["system", "code", "display"] : ["system", "display"],
        properties: { system: { enum: systems } },
      },
    ],
  };
}

function familySchema(f) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${BASE_ID}/${f.name}.schema.json`,
    title: f.title,
    type: "object",
    additionalProperties: false,
    required: ["subject", "predicate", "object", "provenance"],
    properties: {
      subject: nodeSchema(f.subjectSystems, f.subjectCodeRequired),
      predicate: { enum: f.predicates },
      object: nodeSchema(f.objectSystems, f.objectCodeRequired),
      provenance: { $ref: "defs.schema.json#/$defs/provenance" },
    },
  };
}

// The term table is a different artifact kind, so it gets its own generator
// rather than being squeezed through familySchema(). Two halves: `term` and
// `externalCopyrightNotice` are ours to shape, and `loinc` is a fixed column
// list whose values are byte-equal to the release. additionalProperties:false on
// the loinc block is what stops a future change quietly widening the 12 pinned
// columns to all 40 in Loinc.csv.
function termTableSchema(t) {
  const loincProps = {};
  for (const c of t.loincColumns) loincProps[c] = { type: "string", minLength: 1 };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${BASE_ID}/${t.name}.schema.json`,
    title: t.title,
    type: "object",
    additionalProperties: false,
    required: ["term", "loinc", "cascade"],
    properties: {
      term: {
        type: "object",
        additionalProperties: false,
        required: ["system", "code", "display", "displayField"],
        properties: {
          system: { enum: t.systems },
          code: { type: "string", minLength: 1 },
          // Section 10(c): the identifier and a licensed display name travel
          // together, so display can never be empty.
          display: { type: "string", minLength: 1 },
          displayField: { enum: t.displayFields },
        },
      },
      externalCopyrightNotice: { type: "string", minLength: 1 },
      loinc: {
        type: "object",
        additionalProperties: false,
        properties: loincProps,
      },
      cascade: { type: "object" },
    },
  };
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

mkdirSync(SCHEMA_DIR, { recursive: true });
writeJson(join(SCHEMA_DIR, "defs.schema.json"), defs);
for (const f of FAMILIES) {
  writeJson(join(SCHEMA_DIR, `${f.name}.schema.json`), familySchema(f));
}
for (const t of TERM_TABLES) {
  writeJson(join(SCHEMA_DIR, `${t.name}.schema.json`), termTableSchema(t));
}
console.log(
  `Wrote ${FAMILIES.length + TERM_TABLES.length + 1} schema files to schema/`,
);
