// LOINC 2.83 -> the term tables (terms/) and the two relation families
// (data/lab-panel.jsonl, data/lab-group.jsonl).
//
// HARD WALL: this pipeline reads exactly five files out of the release, listed
// in READS below, and scripts/lib/loinc.mjs refuses by basename every file that
// carries content this repository may not redistribute (the Part-derived files
// restricted by Section 5, the Answer files, the Document Ontology, the RSNA
// Radiology Playbook, the linguistic variants). One read from any of those and
// the artifact stops being openly redistributable, which is the premise of the
// whole repository. The wall is a tripwire for a future rebuild that grows a
// new read, not an active filter over anything here today.
//
// The release itself is never copied into this repository: it is read in place,
// read-only, from $LOINC_RELEASE_DIR. The main table alone is 84 MB.
//
// No network, no wall-clock, no randomness. Dates are the constants in
// provenance.mjs so a rebuild reproduces the committed bytes.

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { writeJsonl, writeTermJsonl } from "../lib/canonical.mjs";
import { provenance, BUILD_DATE, SOURCE_VERSIONS, CITATIONS } from "../lib/provenance.mjs";
import { DATA_DIR, TERMS_DIR, INPUTS, requireInput, InputMissingError } from "../lib/paths.mjs";
import { forEachCsvRecord, readCsvColumns } from "../lib/loinc.mjs";
import { TERM_TABLE_BY_NAME } from "../lib/families.mjs";

const SOURCE = "loinc";
const TERM_TABLE = TERM_TABLE_BY_NAME["loinc-term"];
const LOINC_COLUMNS = TERM_TABLE.loincColumns;

// Section 10(c) accepts four display names. LONG_COMMON_NAME is the only one
// that is never empty (DisplayName is empty for 28,721 of 28,786 clinical terms
// and SHORTNAME for 13,637 terms overall), so it is the constant this round.
// The field travels in every row because the license cares which field a
// display came from, not because the answer varies yet.
const DISPLAY_FIELD = "LONG_COMMON_NAME";

// LOINC CLASSTYPE. 3 (claims attachments) and 4 (surveys) are out of scope:
// surveys get their own round, where the instrument-licensing question
// (inclusion in LOINC is not permission to administer) can be answered.
const CLASSTYPE_LAB = "1";
const CLASSTYPE_CLINICAL = "2";

// The Category values in GroupLoincTerms.csv that name a laboratory grouping.
// Their union is 6,610 of the 7,900 groups that have members. The remaining
// categories (Radiology, Document groups, the vital-sign and anthropometric
// flowsheets, and the social-history groups) are clinical groupings and are out
// of scope for a family named lab-group.
const LAB_GROUP_CATEGORIES = [
  "Drugs of abuse",
  "Eye microbiology",
  "Flowsheet - laboratory",
  "Genitourinary microbiology",
  "Mass-Molar conversion",
  "Reportable microbiology",
  "Respiratory microbiology",
  "Smoking - biochemical markers",
];

const READS = {
  loincTable: ["LoincTable", "Loinc.csv"],
  consumerName: ["AccessoryFiles", "ConsumerName", "ConsumerName.csv"],
  panels: ["AccessoryFiles", "PanelsAndForms", "PanelsAndForms.csv"],
  groups: ["AccessoryFiles", "GroupFile", "Group.csv"],
  groupTerms: ["AccessoryFiles", "GroupFile", "GroupLoincTerms.csv"],
};

function releasePath(root, key) {
  return join(root, ...READS[key]);
}

// --- pass 1: the accessory files, which are small enough to hold ------------

function readConsumerNames(root) {
  const m = new Map();
  forEachCsvRecord(releasePath(root, "consumerName"), (get) => {
    const code = get("LoincNumber");
    const name = get("ConsumerName");
    if (code && name) m.set(code, name);
  });
  return m;
}

// CLASSTYPE for every code in the release. Needed BEFORE the slice pass,
// because "is a lab panel" is defined by CLASSTYPE and the panel file does not
// carry it. One extra scan of the main table is the honest way to get it; the
// alternative is buffering every candidate row in memory and filtering after.
function readClassTypes(root) {
  const m = new Map();
  forEachCsvRecord(releasePath(root, "loincTable"), (get) => {
    const code = get("LOINC_NUM");
    if (code) m.set(code, get("CLASSTYPE"));
  });
  return m;
}

// A lab panel is a CLASSTYPE 1 term that appears as ParentLoinc in
// PanelsAndForms.csv. That is NOT the same set as PanelType = "Panel" in
// Loinc.csv: the rest of those are convenience groups and organizers, and the
// panel file is the artifact that actually states membership. The file also
// carries survey and clinical panels, whose parents are CLASSTYPE 4 and 2; a
// family named lab-panel does not carry those, and the survey ones are out of
// scope for this round entirely.
function readPanels(root, classTypes) {
  const parents = new Set();
  const allParents = new Set();
  const pairs = new Set();
  forEachCsvRecord(releasePath(root, "panels"), (get) => {
    const parent = get("ParentLoinc");
    const member = get("Loinc");
    if (!parent || !member) return;
    allParents.add(parent);
    if (classTypes.get(parent) !== CLASSTYPE_LAB) return;
    parents.add(parent);
    // Most parents (1,697 of 1,939) appear as their own first row. A panel does
    // not have itself as a member, so the self-row is dropped. The same parent
    // and member pair also appears more than once, so pairs is a Set.
    if (parent === member) return;
    pairs.add(`${parent}\t${member}`);
  });
  return { parents, allParents, pairs };
}

function readGroups(root) {
  const names = new Map();
  forEachCsvRecord(releasePath(root, "groups"), (get) => {
    const id = get("GroupId");
    if (id) names.set(id, get("Group"));
  });
  const labCategories = new Set(LAB_GROUP_CATEGORIES);
  const pairs = new Set();
  const groupIds = new Set();
  forEachCsvRecord(releasePath(root, "groupTerms"), (get) => {
    if (!labCategories.has(get("Category"))) return;
    const id = get("GroupId");
    const code = get("LoincNumber");
    if (!id || !code) return;
    groupIds.add(id);
    pairs.add(`${id}\t${code}`);
  });
  return { names, pairs, groupIds };
}

// --- pass 2: the term slice ------------------------------------------------

function isCommonlyRanked(rank) {
  return Boolean(rank) && rank !== "0";
}

export function run() {
  const root = requireInput(INPUTS.loincReleaseDir, "LOINC release directory ($LOINC_RELEASE_DIR)");
  if (!SOURCE_VERSIONS[SOURCE]) {
    throw new Error(`no pinned version for source "${SOURCE}" in sources/SOURCE_VERSIONS.json`);
  }
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(TERMS_DIR, { recursive: true });

  const classTypes = readClassTypes(root);
  const consumerNames = readConsumerNames(root);
  const panels = readPanels(root, classTypes);
  const groups = readGroups(root);

  const panelMembers = new Set();
  for (const p of panels.pairs) panelMembers.add(p.split("\t")[1]);
  const groupMembers = new Set();
  for (const p of groups.pairs) groupMembers.add(p.split("\t")[1]);

  // The slice. A laboratory term is in scope when it is commonly ranked, or is
  // in or is a lab panel, or is a member of a laboratory-category LOINC Group.
  // COMMON_TEST_RANK is the ranking field (COMMON_ORDER_RANK would change the
  // count by one row; one field, stated once). The lab slice deliberately keeps
  // DISCOURAGED, TRIAL and DEPRECATED terms, because real records carry retired
  // lab codes and STATUS travels in every row for the consumer to act on.
  // A clinical term is in scope when its STATUS is ACTIVE.
  const labRows = [];
  const clinicalRows = [];
  const longCommonName = new Map();
  const stats = {
    recordsScanned: 0,
    labByRank: 0,
    labByPanel: 0,
    labByGroup: 0,
    labStatus: {},
    clinicalSkippedNotActive: 0,
    noticed: { lab: 0, clinical: 0 },
  };

  forEachCsvRecord(releasePath(root, "loincTable"), (get) => {
    stats.recordsScanned++;
    const code = get("LOINC_NUM");
    if (!code) return;
    const classtype = get("CLASSTYPE");
    const lcn = get("LONG_COMMON_NAME");
    const isLab = classtype === CLASSTYPE_LAB;
    const isClinical = classtype === CLASSTYPE_CLINICAL;
    if (!isLab && !isClinical) return;

    let keep = false;
    let cls = null;
    if (isLab) {
      const byRank = isCommonlyRanked(get("COMMON_TEST_RANK"));
      const byPanel = panels.parents.has(code) || panelMembers.has(code);
      const byGroup = groupMembers.has(code);
      if (byRank) stats.labByRank++;
      if (byPanel) stats.labByPanel++;
      if (byGroup) stats.labByGroup++;
      keep = byRank || byPanel || byGroup;
      cls = "lab";
    } else {
      keep = get("STATUS") === "ACTIVE";
      if (!keep) stats.clinicalSkippedNotActive++;
      cls = "clinical";
    }
    if (!keep) return;

    // Section 10(c): a LOINC identifier and a licensed display name travel
    // together. A row with a consumer name and no licensed display is a license
    // defect, so it is a build failure, not a dropped row.
    if (!lcn) {
      throw new Error(`LOINC ${code}: no ${DISPLAY_FIELD}, so no licensed display name to ship`);
    }
    longCommonName.set(code, lcn);

    const loinc = {};
    for (const c of LOINC_COLUMNS) {
      if (c === "ConsumerName") {
        const cn = consumerNames.get(code);
        if (cn) loinc[c] = cn;
        continue;
      }
      const v = get(c);
      if (v !== "") loinc[c] = v;
    }
    const notice = get("EXTERNAL_COPYRIGHT_NOTICE");
    const row = {
      term: { system: "LOINC", code, display: lcn, displayField: DISPLAY_FIELD },
      loinc,
      cascade: {},
    };
    // Third-party content inside LOINC carries its own notice or is deleted.
    // First-class on the row, not buried in the loinc block, because it governs
    // what a consumer may do with the row.
    if (notice) {
      row.externalCopyrightNotice = notice;
      stats.noticed[cls]++;
    }
    if (isLab) {
      const st = get("STATUS") || "(none)";
      stats.labStatus[st] = (stats.labStatus[st] || 0) + 1;
      labRows.push(row);
    } else {
      clinicalRows.push(row);
    }
  });

  const labCount = writeTermJsonl(join(TERMS_DIR, "loinc-lab.jsonl"), labRows, LOINC_COLUMNS);
  const clinicalCount = writeTermJsonl(
    join(TERMS_DIR, "loinc-clinical.jsonl"),
    clinicalRows,
    LOINC_COLUMNS,
  );
  writeTermMeta("loinc-lab", labCount);
  writeTermMeta("loinc-clinical", clinicalCount);

  // --- the two relation families ------------------------------------------
  //
  // A relation row may only reference a LOINC code that an emitted term table
  // carries. This is a license requirement rather than tidiness: a relation row
  // has nowhere to put an externalCopyrightNotice (the family schemas are
  // additionalProperties:false), so a row referencing a noticed code would ship
  // third-party content stripped of its notice. Without the rule the panel
  // family references 11 noticed codes and the group family 190.
  const inTerms = longCommonName;
  const dropped = { panel: {}, group: {} };

  const panelRows = [];
  let panelDropped = 0;
  for (const pair of panels.pairs) {
    const [parent, member] = pair.split("\t");
    if (!inTerms.has(parent) || !inTerms.has(member)) {
      panelDropped++;
      const why = !inTerms.has(parent) ? "parent" : "member";
      dropped.panel[why] = (dropped.panel[why] || 0) + 1;
      continue;
    }
    panelRows.push({
      subject: { system: "LOINC", code: parent, display: inTerms.get(parent) },
      predicate: "has_member",
      object: { system: "LOINC", code: member, display: inTerms.get(member) },
      // A direct transcription of a mature LOINC artifact.
      provenance: provenance(SOURCE, { method: "derived", evidenceTier: "established" }),
    });
  }

  const groupRows = [];
  let groupDropped = 0;
  for (const pair of groups.pairs) {
    const [id, code] = pair.split("\t");
    const name = groups.names.get(id);
    if (!name) {
      groupDropped++;
      dropped.group["group id absent from Group.csv"] =
        (dropped.group["group id absent from Group.csv"] || 0) + 1;
      continue;
    }
    if (!inTerms.has(code)) {
      groupDropped++;
      dropped.group["member not in an emitted term table"] =
        (dropped.group["member not in an emitted term table"] || 0) + 1;
      continue;
    }
    groupRows.push({
      // The Group Name is what the license requires to travel with a Group id,
      // which is not a LOINC code. node.display already requires one.
      subject: { system: "LOINC-GROUP", code: id, display: name },
      predicate: "groups",
      object: { system: "LOINC", code, display: inTerms.get(code) },
      // The Group file is a Beta artifact whose own readme says a user must
      // validate it before any use in clinical care, so these land candidate.
      provenance: provenance(SOURCE, { method: "derived", evidenceTier: "candidate" }),
    });
  }

  const panelWritten = writeJsonl(join(DATA_DIR, "lab-panel.jsonl"), panelRows);
  const groupWritten = writeJsonl(join(DATA_DIR, "lab-group.jsonl"), groupRows);

  return {
    "loinc-lab": labCount,
    "loinc-clinical": clinicalCount,
    "lab-panel": panelWritten,
    "lab-group": groupWritten,
    stats: {
      ...stats,
      labPanelParents: panels.parents.size,
      allPanelParentsInFile: panels.allParents.size,
      panelPairsBeforeTermFilter: panels.pairs.size,
      panelDropped,
      panelDropReasons: dropped.panel,
      labGroupsWithMembers: groups.groupIds.size,
      groupPairsBeforeTermFilter: groups.pairs.size,
      groupDropped,
      groupDropReasons: dropped.group,
    },
  };
}

// File-level provenance for a term table, plus a content hash over the emitted
// rows. Provenance is file-level here rather than per-row because one source and
// one version are uniform across every row, and repeating the block tens of
// thousands of times costs megabytes to say the same thing. The hash is what
// gives terms/ the integrity check that data/ gets from BUILD_MANIFEST.json.
function writeTermMeta(name, rows) {
  const file = join(TERMS_DIR, `${name}.jsonl`);
  const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
  const meta = {
    _comment:
      "File-level provenance for a term table. sha256 is over the committed JSONL bytes and is the integrity reference for terms/, mirroring data/BUILD_MANIFEST.json.",
    file: `${name}.jsonl`,
    provenance: {
      source: SOURCE,
      sourceVersion: SOURCE_VERSIONS[SOURCE],
      method: "derived",
      citation: CITATIONS[SOURCE],
      addedDate: BUILD_DATE,
      reviewedDate: BUILD_DATE,
    },
    rows,
    sha256,
  };
  writeFileSync(join(TERMS_DIR, `${name}.meta.json`), JSON.stringify(meta, null, 2) + "\n");
  return meta;
}

export { InputMissingError };

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(run(), null, 2));
}
