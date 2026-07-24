// Fresh MED-RT parser (does NOT reuse any code path that touched restricted
// inputs). Parses <association> blocks from a line iterable, one parsing code
// path shared by the streaming build and the unit tests.
//
// MED-RT XML shape (each element on its own line):
//   <association>
//     <namespace>MED-RT</namespace>
//     <name>may_treat</name>              <- the relationship (FIRST <name>)
//     <from_namespace>RxNorm</from_namespace>
//     <from_name>palivizumab</from_name>
//     <from_code>194279</from_code>
//     <to_namespace>MeSH</to_namespace>
//     <to_name>Respiratory Syncytial Virus Infections</to_name>
//     <to_code>M0027589</to_code>
//     <qualifier> ... <name>Authority</name> ... </qualifier>  <- ignored
//   </association>

const FIELD_RE =
  /<(name|from_namespace|from_name|from_code|to_namespace|to_name|to_code)>([\s\S]*?)<\/\1>/;

const KEY_MAP = {
  name: "name",
  from_namespace: "fromNamespace",
  from_name: "fromName",
  from_code: "fromCode",
  to_namespace: "toNamespace",
  to_name: "toName",
  to_code: "toCode",
};

export function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

// Parse the inner lines of one <association> block into a plain object.
// Shared by iterateAssociations (whole-string) and the streaming build.
export function parseAssociationBlock(innerLines) {
  const cur = {};
  for (const line of innerLines) {
    const m = line.match(FIELD_RE);
    if (!m) continue;
    const key = KEY_MAP[m[1]];
    // The association's own relationship name is the FIRST <name>; a later
    // <name> belongs to a <qualifier> and must be ignored.
    if (key === "name" && cur.name !== undefined) continue;
    cur[key] = decodeEntities(m[2]);
  }
  return cur;
}

// Yield one plain object per <association> block from a line iterable.
export function* iterateAssociations(lines) {
  let cur = null;
  for (const line of lines) {
    if (line.includes("<association>")) {
      cur = [];
      continue;
    }
    if (line.includes("</association>")) {
      if (cur) yield parseAssociationBlock(cur);
      cur = null;
      continue;
    }
    if (cur) cur.push(line);
  }
}

// Map a MED-RT namespace to an open code system, or null if walled/unknown.
export function mapNamespace(ns) {
  switch (ns) {
    case "RxNorm":
      return "RXNORM";
    case "MED-RT":
      return "MED-RT";
    case "MeSH":
      return "MESH";
    default:
      return null; // "SNOMED CT" and anything else is walled/out-of-scope
  }
}

// Which MED-RT relationships become drug-condition rows.
export const DRUG_CONDITION_PREDICATES = new Set(["may_treat", "may_prevent"]);
const SUBJECT_OK = new Set(["RXNORM", "MED-RT"]);
const OBJECT_OK = new Set(["MESH", "MED-RT"]);

// Convert one association to a drug-condition row, or return null if it should
// be dropped (wrong relationship, or a walled/unsupported code system on either
// side). Also returns a reason for excluded rows so the build can report them.
export function toDrugConditionRow(a, makeProvenance) {
  if (!DRUG_CONDITION_PREDICATES.has(a.name)) return { row: null, reason: "not-may-treat-prevent" };
  const subjectSystem = mapNamespace(a.fromNamespace);
  const objectSystem = mapNamespace(a.toNamespace);
  if (!SUBJECT_OK.has(subjectSystem)) {
    return { row: null, reason: `walled-or-unsupported-subject:${a.fromNamespace}` };
  }
  if (!OBJECT_OK.has(objectSystem)) {
    return { row: null, reason: `walled-or-unsupported-object:${a.toNamespace}` };
  }
  if (!a.fromCode || !a.toCode || !a.fromName || !a.toName) {
    return { row: null, reason: "incomplete" };
  }
  return {
    row: {
      subject: { system: subjectSystem, code: a.fromCode, display: a.fromName },
      predicate: a.name,
      object: { system: objectSystem, code: a.toCode, display: a.toName },
      provenance: makeProvenance(),
    },
    reason: null,
  };
}
