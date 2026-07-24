// Minimal, dependency-free JSON Schema validator.
//
// Supports exactly the keyword subset the knowledge schemas use:
//   $ref (local "#/..." and relative-file "file.json#/..."), allOf,
//   type (string or array), required, properties, additionalProperties (bool),
//   enum, const, pattern, minLength, minItems, items.
//
// This is deliberately small: the JSON Schema files are the authoritative
// contract; this validator interprets them. It is not a general-purpose engine.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const fileCache = new Map();

function loadSchemaFile(absPath) {
  if (!fileCache.has(absPath)) {
    fileCache.set(absPath, JSON.parse(readFileSync(absPath, "utf8")));
  }
  return fileCache.get(absPath);
}

function pointerGet(doc, pointer) {
  // pointer like "/$defs/node"
  let cur = doc;
  for (const rawSeg of pointer.split("/")) {
    if (rawSeg === "") continue;
    const seg = rawSeg.replace(/~1/g, "/").replace(/~0/g, "~");
    cur = cur?.[seg];
    if (cur === undefined) return undefined;
  }
  return cur;
}

function resolveRef(ref, ctx) {
  const [filePart, pointer = ""] = ref.split("#");
  let doc = ctx.rootDoc;
  let baseDir = ctx.baseDir;
  if (filePart) {
    const abs = resolve(ctx.baseDir, filePart);
    doc = loadSchemaFile(abs);
    baseDir = dirname(abs);
  }
  const schema = pointer ? pointerGet(doc, pointer) : doc;
  return { schema, ctx: { ...ctx, rootDoc: doc, baseDir } };
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // "object" | "string" | "number" | "boolean"
}

function checkType(value, type) {
  const t = typeOf(value);
  const types = Array.isArray(type) ? type : [type];
  for (const want of types) {
    if (want === "integer") {
      if (t === "number" && Number.isInteger(value)) return true;
    } else if (want === t) {
      return true;
    }
  }
  return false;
}

function validateNode(value, schema, ctx, path, errors) {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    errors.push(`${path}: schema is false (nothing valid here)`);
    return;
  }

  if (schema.$ref) {
    const { schema: target, ctx: nextCtx } = resolveRef(schema.$ref, ctx);
    if (!target) {
      errors.push(`${path}: unresolved $ref ${schema.$ref}`);
      return;
    }
    validateNode(value, target, nextCtx, path, errors);
    // A $ref may sit alongside other keywords; continue checking siblings.
  }

  if (schema.allOf) {
    for (const sub of schema.allOf) validateNode(value, sub, ctx, path, errors);
  }

  if (schema.type && !checkType(value, schema.type)) {
    errors.push(`${path}: expected type ${JSON.stringify(schema.type)}, got ${typeOf(value)}`);
    return; // further checks assume the type held
  }

  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: string does not match pattern ${schema.pattern}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: array shorter than minItems ${schema.minItems}`);
    }
    if (schema.items) {
      value.forEach((item, i) => validateNode(item, schema.items, ctx, `${path}[${i}]`, errors));
    }
  }

  if (typeOf(value) === "object") {
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in value)) errors.push(`${path}: missing required property "${key}"`);
      }
    }
    const props = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) errors.push(`${path}: additional property "${key}" not allowed`);
      }
    }
    for (const [key, subschema] of Object.entries(props)) {
      if (key in value) {
        validateNode(value[key], subschema, ctx, `${path}/${key}`, errors);
      }
    }
  }
}

// Validate `value` against the schema file at `schemaPath`. Returns an array of
// human-readable error strings (empty === valid).
export function validate(value, schemaPath) {
  const abs = resolve(schemaPath);
  const rootDoc = loadSchemaFile(abs);
  const ctx = { rootDoc, baseDir: dirname(abs) };
  const errors = [];
  validateNode(value, rootDoc, ctx, "$", errors);
  return errors;
}
