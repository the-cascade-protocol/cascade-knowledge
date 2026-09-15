// Canonical, byte-deterministic serialization for knowledge rows.
//
// Determinism rules enforced here:
//  - fixed key order (never depends on insertion order),
//  - `code` omitted entirely when absent (never emitted as null),
//  - rows in a file are sorted by their canonical string, so output bytes do
//    not depend on the order rows were produced in.
//
// No wall-clock and no randomness live in this module.

import { readFileSync, writeFileSync } from "node:fs";

const NODE_KEYS = ["system", "code", "display"];
const PROV_KEYS = [
  "source",
  "sourceVersion",
  "method",
  "evidenceTier",
  "citation",
  "addedDate",
  "reviewedDate",
];

function orderedNode(node) {
  const out = {};
  for (const k of NODE_KEYS) {
    if (k === "code") {
      if (node.code !== undefined && node.code !== null && node.code !== "") {
        out.code = String(node.code);
      }
      continue;
    }
    out[k] = node[k];
  }
  return out;
}

function orderedProvenance(p) {
  const out = {};
  for (const k of PROV_KEYS) out[k] = p[k];
  return out;
}

// Produce the canonical single-line JSON for one row.
export function serializeRow(row) {
  const ordered = {
    subject: orderedNode(row.subject),
    predicate: row.predicate,
    object: orderedNode(row.object),
    provenance: orderedProvenance(row.provenance),
  };
  return JSON.stringify(ordered);
}

// Sort rows deterministically and write JSONL (trailing newline). Returns the
// row count actually written after de-duplicating identical canonical lines.
export function writeJsonl(path, rows) {
  const lines = rows.map(serializeRow);
  // De-duplicate exact duplicate rows (same canonical bytes) deterministically.
  const unique = Array.from(new Set(lines));
  unique.sort();
  writeFileSync(path, unique.length ? unique.join("\n") + "\n" : "");
  return unique.length;
}

// Serialize rows to a canonical JSONL string without touching disk (used by the
// determinism validator to compare a rebuild against the committed file).
export function serializeJsonl(rows) {
  const lines = Array.from(new Set(rows.map(serializeRow)));
  lines.sort();
  return lines.length ? lines.join("\n") + "\n" : "";
}

export function readJsonl(path) {
  const text = readFileSync(path, "utf8");
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    out.push(JSON.parse(t));
  }
  return out;
}

// --- Term tables (the second artifact kind) --------------------------------
//
// A term row is attributes OF one code rather than a relation between two, so
// it has its own canonical form. Same determinism rules: fixed key order, empty
// source fields omitted rather than emitted as empty strings (the same
// convention `code` already follows above, and the one the byte-equality
// validator checks against), rows sorted before writing.

const TERM_KEYS = ["system", "code", "display", "displayField"];

export function serializeTermRow(row, loincColumns) {
  const term = {};
  for (const k of TERM_KEYS) term[k] = row.term[k];
  const loinc = {};
  for (const c of loincColumns) {
    const v = row.loinc?.[c];
    if (v === undefined || v === null || v === "") continue;
    loinc[c] = String(v);
  }
  const ordered = { term };
  if (row.externalCopyrightNotice) {
    ordered.externalCopyrightNotice = row.externalCopyrightNotice;
  }
  ordered.loinc = loinc;
  ordered.cascade = row.cascade || {};
  return JSON.stringify(ordered);
}

export function serializeTermJsonl(rows, loincColumns) {
  const lines = Array.from(new Set(rows.map((r) => serializeTermRow(r, loincColumns))));
  lines.sort();
  return lines.length ? lines.join("\n") + "\n" : "";
}

export function writeTermJsonl(path, rows, loincColumns) {
  const text = serializeTermJsonl(rows, loincColumns);
  writeFileSync(path, text);
  return text ? text.split("\n").filter((l) => l).length : 0;
}
