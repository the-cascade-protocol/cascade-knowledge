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
import { basename, join } from "node:path";
import { SOURCES_DIR } from "./paths.mjs";

// The wall is an ALLOWLIST, not a denylist. Five files out of the release are
// readable, and everything else is refused, because a denylist only stops the
// restricted files someone thought of: the release ships dozens of accessory
// files and grows more every version, so "not on the deny list" is not evidence
// that a file is redistributable.
//
// These five are the ones whose content this repository has verified it may
// redistribute under the LOINC license.
export const ALLOWED_INPUT_BASENAMES = [
  "Loinc.csv",
  "ConsumerName.csv",
  "PanelsAndForms.csv",
  "Group.csv",
  "GroupLoincTerms.csv",
];

// Kept as documentation of WHY specific files are out, and asserted by a test.
// Every one of these carries SNOMED CT, RadLex or UMLS-gated content, or is
// part-derived and therefore restricted by Section 5 of the license. The list
// is explicit because the license's wording and the release's filenames do not
// line up: the "Ontology File" the license names is a different artifact from
// the release's DocumentOntology.csv. LoincAnswerListLink.csv appears twice in
// the release (once under AccessoryFiles/AnswerFile/ and once inside
// PanelsAndForms/), which is why matching is on basename rather than on a path.
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

const ALLOWED_SET = new Set(ALLOWED_INPUT_BASENAMES.map((b) => b.toLowerCase()));

export class ForbiddenInputError extends Error {
  constructor(path) {
    super(
      `refusing to read a LOINC release file that is not on the allowlist: ${basename(path)}. ` +
        `Readable files are: ${ALLOWED_INPUT_BASENAMES.join(", ")}. ` +
        `Everything else in the release is either restricted content (Part-derived, ` +
        `Answer, Ontology, Radiology Playbook) or has not been license-verified for ` +
        `redistribution; see LICENSE-NOTICES.md.`,
    );
    this.name = "ForbiddenInputError";
    this.forbiddenInput = true;
  }
}

export function isAllowedInput(path) {
  return ALLOWED_SET.has(basename(String(path)).toLowerCase());
}

// Retained for readability at call sites and in tests.
export function isForbiddenInput(path) {
  return !isAllowedInput(path);
}

export function assertInputAllowed(path) {
  if (!isAllowedInput(path)) throw new ForbiddenInputError(path);
  return path;
}

// The release directory must be the release this repository is pinned to.
// Pointed at a different version, every renamed LOINC term would be reported as
// a Section 2 "LOINC values are never edited" violation, which is a confusing
// way to learn that the wrong directory was exported.
export function assertReleaseVersion(releaseDir, pinnedVersion) {
  const dir = basename(String(releaseDir).replace(/\/+$/, ""));
  const m = /(\d+\.\d+)$/.exec(dir);
  if (!m) {
    throw new Error(
      `cannot tell which LOINC release "${dir}" is: expected a directory named like ` +
        `"Loinc_${pinnedVersion}" so the pinned version can be verified`,
    );
  }
  if (m[1] !== pinnedVersion) {
    throw new Error(
      `LOINC release mismatch: $LOINC_RELEASE_DIR is ${m[1]} but sources/SOURCE_VERSIONS.json ` +
        `pins ${pinnedVersion}. Bump the pin and rebuild, or point at the pinned release.`,
    );
  }
  return m[1];
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


// --- the notice chokepoint --------------------------------------------------
//
// Section 10(b) of the LOINC license gives two options for third-party content
// carried inside LOINC: comply with that third party's terms, or delete the
// content. sources/loinc-notice-verdicts.json records which option each distinct
// notice gets, with a reason, as a document a person can audit.
//
// It is FAIL-CLOSED on purpose, and matched on the exact notice string rather
// than a pattern. A regex over notice text can only recognise the restrictions
// somebody already thought of: a future release that adds a restrictive notice
// in wording no pattern anticipated would ship it silently. An exact-match
// table cannot do that. It can only fail, which is the behaviour worth having.

export const NOTICE_VERDICTS_PATH = join(SOURCES_DIR, "loinc-notice-verdicts.json");

export function loadNoticeVerdicts(path) {
  path = path || NOTICE_VERDICTS_PATH;
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const map = new Map();
  for (const v of doc.verdicts) {
    if (v.verdict !== "permissive" && v.verdict !== "restricted") {
      throw new Error(`loinc-notice-verdicts.json: "${v.holder}" has verdict "${v.verdict}", expected permissive or restricted`);
    }
    if (map.has(v.notice)) {
      throw new Error(`loinc-notice-verdicts.json: duplicate notice text for "${v.holder}"`);
    }
    map.set(v.notice, v);
  }
  return map;
}

// Build the error for notices no human has ruled on. Names the notice and the
// codes carrying it, so the verdict can be written without re-deriving anything.
export function unrecognisedNoticeError(unrecognised) {
  const lines = [
    `${unrecognised.size} LOINC copyright notice(s) in this release are not in sources/loinc-notice-verdicts.json.`,
    `Every distinct EXTERNAL_COPYRIGHT_NOTICE needs an explicit human verdict of "permissive" or "restricted"`,
    `before the terms carrying it can be built. Add each one verbatim, with a reason, and rebuild.`,
    ``,
  ];
  for (const [notice, codes] of unrecognised) {
    const shown = codes.slice(0, 8).join(", ") + (codes.length > 8 ? `, and ${codes.length - 8} more` : "");
    lines.push(`  ${codes.length} code(s): ${shown}`);
    lines.push(`  notice: ${JSON.stringify(notice)}`);
    lines.push(``);
  }
  const e = new Error(lines.join("\n"));
  e.name = "UnrecognisedNoticeError";
  e.unrecognisedNotice = true;
  return e;
}
