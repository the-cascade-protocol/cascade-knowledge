// LOINC release reading: the forbidden-input wall, and a dependency-free CSV
// reader for the release's own CSV dialect.
//
// HARD WALL: the LOINC release ships files whose content is not ours to
// redistribute. Part-derived files are restricted by Section 5 of the license;
// the Answer files, the Document Ontology and the RSNA Radiology Playbook carry
// SNOMED CT, RadLex or UMLS-gated content. A single read from one of those and
// the resulting artifact is no longer openly redistributable, which is the whole
// premise of this repository. `assertInputAllowed` refuses them by basename
// rather than trusting a future rebuild to remember, in the same spirit as the
// prescribable-only wall at the top of build-rxnorm-prescribable.mjs.
//
// This is a tripwire, not a filter: nothing in this repository has a reason to
// open these paths, and the point is that a future change which grows one gets
// stopped here instead of shipping.
//
// No network and no wall-clock in this module.

import { readFileSync } from "node:fs";
import { basename } from "node:path";

// Never opened. See pin 4 of the round brief and Sections 2, 5 and 10 of the
// LOINC license. LoincAnswerListLink.csv appears twice in the release (once
// under AccessoryFiles/AnswerFile/ and once inside PanelsAndForms/), which is
// why the wall matches on basename rather than on a relative path.
export const FORBIDDEN_INPUT_BASENAMES = [
  "Part.csv",
  "LoincPartLink_Primary.csv",
  "LoincPartLink_Supplementary.csv",
  "PartRelatedCodeMapping.csv",
  "PartChangeSnapshot.csv",
  "AnswerList.csv",
  "LoincAnswerListLink.csv",
  "DocumentOntology.csv",
  "DocumentOntology.owl",
  "ComponentHierarchyBySystem.csv",
  "LinguisticVariants.csv",
  "LoincRsnaRadiologyPlaybook.csv",
];

const FORBIDDEN_SET = new Set(FORBIDDEN_INPUT_BASENAMES.map((b) => b.toLowerCase()));

export class ForbiddenInputError extends Error {
  constructor(path) {
    super(
      `refusing to read a forbidden LOINC input: ${basename(path)}. ` +
        `Part-derived, Answer, Ontology and Radiology Playbook files carry content ` +
        `that is not openly redistributable; see LICENSE-NOTICES.md.`,
    );
    this.name = "ForbiddenInputError";
    this.forbiddenInput = true;
  }
}

// Also refuses any *LinguisticVariant.csv, which the release ships one per
// language under a name that varies (for example "zhCN10LinguisticVariant.csv").
export function isForbiddenInput(path) {
  const b = basename(String(path));
  const lower = b.toLowerCase();
  if (FORBIDDEN_SET.has(lower)) return true;
  return /linguisticvariant\.csv$/i.test(b);
}

export function assertInputAllowed(path) {
  if (isForbiddenInput(path)) throw new ForbiddenInputError(path);
  return path;
}

// Parse one CSV record starting at `i`. Returns [fields, nextIndex] or null at
// end of input. RFC 4180 with the release's CRLF endings: fields may be quoted,
// "" is a literal quote inside a quoted field, and a quoted field may contain
// commas and line breaks.
function parseRecord(text, i) {
  if (i >= text.length) return null;
  const fields = [];
  let field = "";
  let quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (c === ",") {
      fields.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++;
      fields.push(field);
      return [fields, i];
    }
    field += c;
    i++;
  }
  fields.push(field);
  return [fields, i];
}

// Read a release CSV and hand each data record to `onRecord(get, index)`, where
// `get(columnName)` returns that column's value for the current record.
//
// Records are handed over one at a time rather than returned as an array: the
// main table is 84 MB across 40 columns, and materializing every field of every
// record costs far more memory than any caller here needs. The caller keeps the
// handful of columns it wants and the rest is garbage immediately.
//
// Returns the number of data records seen.
export function forEachCsvRecord(path, onRecord) {
  assertInputAllowed(path);
  const text = readFileSync(path, "utf8");
  let i = 0;
  const head = parseRecord(text, 0);
  if (!head) return 0;
  const header = head[0];
  i = head[1];
  const indexOf = new Map(header.map((name, idx) => [name, idx]));
  let count = 0;
  while (i < text.length) {
    const rec = parseRecord(text, i);
    if (!rec) break;
    const [fields, next] = rec;
    i = next;
    // A trailing blank line is not a record.
    if (fields.length === 1 && fields[0] === "") continue;
    const get = (name) => {
      const idx = indexOf.get(name);
      if (idx === undefined) {
        throw new Error(`column "${name}" is not in ${basename(path)}`);
      }
      const v = fields[idx];
      return v === undefined ? "" : v;
    };
    count++;
    onRecord(get, count);
  }
  return count;
}

// Read a release CSV into an array of plain objects carrying only `columns`.
// For the small accessory files; the main table uses forEachCsvRecord directly.
export function readCsvColumns(path, columns) {
  const out = [];
  forEachCsvRecord(path, (get) => {
    const row = {};
    for (const c of columns) row[c] = get(c);
    out.push(row);
  });
  return out;
}
