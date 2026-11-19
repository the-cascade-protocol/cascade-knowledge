// Generates schema/defs.schema.json and schema/<family>.schema.json from the
// single family definition in scripts/lib/families.mjs, so the shared row shape
// stays identical across families. Run: node scripts/gen-schemas.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FAMILIES, TERM_TABLES, PRODUCT_STRENGTH } from "./lib/families.mjs";

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

// `codes`, when a family declares one, closes the node's code set: used for a
// label set the family itself defines (the lifecycle classes), where an open
// string would let a typo become a new class.
function nodeSchema(systems, codeRequired, codes) {
  const properties = { system: { enum: systems } };
  if (codes) properties.code = { enum: codes };
  return {
    allOf: [
      { $ref: "defs.schema.json#/$defs/node" },
      {
        type: "object",
        required: codeRequired ? ["system", "code", "display"] : ["system", "display"],
        properties,
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
      subject: nodeSchema(f.subjectSystems, f.subjectCodeRequired, f.subjectCodes),
      predicate: { enum: f.predicates },
      object: nodeSchema(f.objectSystems, f.objectCodeRequired, f.objectCodes),
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

// The product-strength record. Every RxNorm node is code-required: a strength
// row with no product code, or an ingredient with no RxCUI, says nothing anyone
// can join on. `product` is not the shared node, because it also carries the
// term type, and the shared node is closed (additionalProperties:false).
function productStrengthSchema(p) {
  const rxnormNode = {
    type: "object",
    additionalProperties: false,
    required: ["system", "code", "display"],
    properties: {
      system: { enum: p.systems },
      code: { type: "string", pattern: "^\\d+$" },
      display: { type: "string", minLength: 1 },
    },
  };
  const measure = (units) => ({
    type: "object",
    additionalProperties: false,
    required: ["value", "unit"],
    properties: {
      value: { type: "string", pattern: p.decimalPattern },
      unit: units ? { enum: units } : { type: "string", minLength: 1 },
    },
  });
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${BASE_ID}/${p.name}.schema.json`,
    title: p.title,
    type: "object",
    additionalProperties: false,
    required: ["product", "components", "doseForm", "provenance"],
    properties: {
      product: {
        type: "object",
        additionalProperties: false,
        required: ["system", "code", "display", "tty"],
        properties: {
          ...rxnormNode.properties,
          tty: { enum: p.ttys },
        },
      },
      // SBD rows only: the clinical drug (SCD) this branded drug is a tradename
      // of, and the brand name (BN) when RxNorm links one.
      clinicalDrug: rxnormNode,
      brand: rxnormNode,
      // One per active ingredient, in the order the product name lists them.
      components: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["component", "ingredient", "strength"],
          properties: {
            // The clinical drug component (SCDC), e.g. "sertraline 50 MG".
            component: rxnormNode,
            // The ingredient (IN) the component names.
            ingredient: rxnormNode,
            // The precise ingredient (PIN, a salt or ester) when RxNorm states
            // the strength against one, e.g. metoprolol succinate.
            preciseIngredient: rxnormNode,
            strength: measure(),
          },
        },
      },
      // The dose form (DF). `code` is optional only because a release could in
      // principle omit the DF atom; the form text itself is never omitted.
      doseForm: {
        type: "object",
        additionalProperties: false,
        required: ["system", "display"],
        properties: rxnormNode.properties,
      },
      // A quantified product's leading quantity, e.g. "0.4 ML" of a syringe.
      quantity: measure(),
      // An extended-release product's release period, e.g. "24 HR".
      releasePeriod: measure(["HR"]),
      provenance: { $ref: "defs.schema.json#/$defs/provenance" },
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
writeJson(join(SCHEMA_DIR, `${PRODUCT_STRENGTH.name}.schema.json`), productStrengthSchema(PRODUCT_STRENGTH));
console.log(
  `Wrote ${FAMILIES.length + TERM_TABLES.length + 2} schema files to schema/`,
);
