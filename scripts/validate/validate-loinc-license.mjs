// Validator: the LOINC license obligations, checked rather than promised.
//
// The LOINC license is permissive but conditional, and the conditions are
// exactly the kind a data pipeline erodes silently. This validator turns five
// of them into assertions over the emitted bytes:
//
//   1. Section 10(c): a LOINC identifier and a LICENSED display name travel
//      together, and the row records which display field it came from. A
//      Consumer Name is not on the licensed list, so a row carrying one and no
//      licensed display is a failure, not a warning.
//   2. Third-party content inside LOINC keeps its own notice: every row whose
//      source record carries an EXTERNAL_COPYRIGHT_NOTICE carries it verbatim.
//   3. Section 2: LOINC values are never edited. Every value under a row's
//      `loinc` block, and every LOINC display in the two relation families, is
//      byte-equal to the release.
//   4. Only LOINC codes (and LOINC Group ids in the LOINC-GROUP system) ship.
//      An LP, LA or LL identifier is Part, Answer or AnswerList content, which
//      is restricted, so its presence is observable from the output alone.
//   5. A relation row may only reference a LOINC code an emitted term table
//      carries, because a relation row has nowhere to put a notice.
//
// Plus an integrity check: each term table's .meta.json content hash matches
// the file, which is what terms/ has in place of data/BUILD_MANIFEST.json.
//
// Checks 2 and 3 need the release. When $LOINC_RELEASE_DIR is absent they SKIP
// AND SAY SO on stdout: a validator that silently passes because it could not
// look is the failure this repository is trying not to have.
//
// No network anywhere in here.

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { FAMILIES, TERM_TABLES } from "../lib/families.mjs";
import { readJsonl } from "../lib/canonical.mjs";
import { DATA_DIR, TERMS_DIR, INPUTS } from "../lib/paths.mjs";
import { forEachCsvRecord, assertReleaseVersion, loadNoticeVerdicts } from "../lib/loinc.mjs";
import { SOURCE_VERSIONS } from "../lib/provenance.mjs";

// A LOINC code is digits, a hyphen, and a single check digit. A LOINC Group id
// is that with an LG prefix. Part (LP), Answer (LA) and AnswerList (LL)
// identifiers match neither, which is the point.
const LOINC_CODE = /^\d+-\d$/;
const LOINC_GROUP_ID = /^LG\d+-\d$/;

// The relation families built from the LOINC release.
const LOINC_FAMILIES = ["lab-panel", "lab-group"];

function termFiles(termsDir) {
  const out = [];
  for (const t of TERM_TABLES) {
    for (const name of t.files) {
      const p = join(termsDir, `${name}.jsonl`);
      if (existsSync(p)) out.push({ table: t, name, path: p });
    }
  }
  return out;
}

export function validateLoincLicense({
  termsDir = TERMS_DIR,
  dataDir = DATA_DIR,
  releaseDir = INPUTS.loincReleaseDir,
  // Overridable only so the synthetic mini-release fixture can carry its own
  // verdicts instead of putting fabricated notices in the real reviewed file.
  verdictsPath = undefined,
} = {}) {
  const errors = [];
  const notes = [];
  let checked = 0;

  const files = termFiles(termsDir);
  const relationPaths = LOINC_FAMILIES
    .map((fam) => ({ fam, path: join(dataDir, `${fam}.jsonl`) }))
    .filter((f) => existsSync(f.path));
  // Only nothing to check when there is NOTHING to check. Returning early on an
  // empty terms/ alone would wave through every committed relation row, and
  // "the term tables are missing" is the exact state in which check 5 matters
  // most: every LOINC reference in the relation families is then unbacked.
  if (files.length === 0 && relationPaths.length === 0) {
    notes.push("no term tables and no LOINC relation families present: nothing to check");
    return { ok: true, checked: 0, notes, errors };
  }
  if (files.length === 0) {
    errors.push(
      `no term tables under ${termsDir}, but ${relationPaths.map((f) => f.fam).join(" and ")} ` +
        `are committed: every LOINC code they reference is unbacked, so nothing carries its ` +
        `display or any notice it needs`,
    );
  }

  // Load every term row once. Keyed by code for checks 3 and 5.
  const terms = new Map();
  const rowsByFile = new Map();
  for (const f of files) {
    const rows = readJsonl(f.path);
    rowsByFile.set(f.name, { rows, table: f.table });
    rows.forEach((row, i) => {
      const where = `${f.name}.jsonl:${i + 1}`;
      const code = row.term?.code;
      if (!code) return;
      // One row per code, within a table and across them. Without this the map
      // below keeps only the last row for a duplicated code, and checks 2 and 3
      // would never look at the other one: a second, wrong row for a code would
      // be invisible to the byte-equality check.
      const seen = terms.get(code);
      if (seen) {
        errors.push(`${where}: LOINC ${code} is already emitted at ${seen.where} (one row per code)`);
        return;
      }
      terms.set(code, { row, where });
    });
  }

  // --- check 1: identifier + licensed display travel together --------------
  for (const [name, { rows, table }] of rowsByFile) {
    const allowed = new Set(table.displayFields);
    rows.forEach((row, i) => {
      checked++;
      const where = `${name}.jsonl:${i + 1}`;
      const code = row.term?.code;
      if (!code) {
        errors.push(`${where}: no term.code`);
        return;
      }
      if (!row.term?.display) {
        errors.push(`${where} (${code}): no term.display, so no licensed display name travels with the code`);
      }
      if (!allowed.has(row.term?.displayField)) {
        errors.push(
          `${where} (${code}): term.displayField "${row.term?.displayField}" is not one of the display names the LOINC license accepts (${[...allowed].join(", ")})`,
        );
      }
      // A Consumer Name is explicitly NOT a licensed display name.
      if (row.loinc?.ConsumerName && !row.term?.display) {
        errors.push(`${where} (${code}): carries a ConsumerName but no licensed display name`);
      }
    });
  }

  // --- check 4: only LOINC codes and LOINC Group ids ship ------------------
  for (const [name, { rows }] of rowsByFile) {
    rows.forEach((row, i) => {
      const code = row.term?.code;
      if (code && !LOINC_CODE.test(code)) {
        errors.push(`${name}.jsonl:${i + 1}: "${code}" is not a LOINC code (Part/Answer/AnswerList identifiers are restricted content)`);
      }
    });
  }
  const relationRows = new Map();
  for (const { fam, path: p } of relationPaths) {
    const rows = readJsonl(p);
    relationRows.set(fam, rows);
    rows.forEach((row, i) => {
      checked++;
      const where = `${fam}.jsonl:${i + 1}`;
      for (const [side, node] of [["subject", row.subject], ["object", row.object]]) {
        if (!node?.code) continue;
        const ok = node.system === "LOINC-GROUP" ? LOINC_GROUP_ID.test(node.code) : LOINC_CODE.test(node.code);
        if (!ok) {
          errors.push(`${where} ${side}: "${node.code}" is not a valid code in system ${node.system}`);
        }
      }
    });
  }

  // --- check 5: relation rows reference only emitted term codes ------------
  for (const [fam, rows] of relationRows) {
    rows.forEach((row, i) => {
      const where = `${fam}.jsonl:${i + 1}`;
      for (const [side, node] of [["subject", row.subject], ["object", row.object]]) {
        if (node?.system !== "LOINC") continue;
        if (!terms.has(node.code)) {
          errors.push(
            `${where} ${side}: LOINC ${node.code} is referenced but is not in any emitted term table, so nothing carries its display or any notice it needs`,
          );
        }
      }
    });
  }

  // --- check 6: every emitted notice has a reviewed verdict, and is permissive
  //
  // Release-independent: it compares the emitted rows against
  // sources/loinc-notice-verdicts.json, so it runs in CI where the release is
  // absent. Fail-closed both ways: a notice with no verdict is an error, and a
  // notice a human ruled `restricted` must never appear in emitted output.
  const verdicts = loadNoticeVerdicts(verdictsPath);
  const unruled = new Map();
  for (const [name, { rows }] of rowsByFile) {
    rows.forEach((row, i) => {
      const notice = row.externalCopyrightNotice;
      if (!notice) return;
      const v = verdicts.get(notice);
      if (!v) {
        const key = notice;
        if (!unruled.has(key)) unruled.set(key, []);
        unruled.get(key).push(`${name}.jsonl:${i + 1} (${row.term?.code})`);
        return;
      }
      if (v.verdict === "restricted") {
        errors.push(
          `${name}.jsonl:${i + 1} (${row.term?.code}): carries a notice ruled "restricted" in sources/loinc-notice-verdicts.json (${v.holder}), which must be withheld, not emitted`,
        );
      }
    });
  }
  for (const [notice, where] of unruled) {
    const shown = where.slice(0, 5).join(", ") + (where.length > 5 ? `, and ${where.length - 5} more` : "");
    errors.push(
      `${where.length} emitted row(s) carry a copyright notice with no verdict in sources/loinc-notice-verdicts.json: ${shown}. Notice: ${JSON.stringify(notice.slice(0, 160))}`,
    );
  }

  // --- the standing report: which relation rows reference a noticed code -----
  //
  // A relation row has nowhere to put a copyright notice (the family schemas are
  // additionalProperties:false), so where lab-panel references a code whose term
  // row carries one, the notice travels with the TERM TABLE and not with the
  // relation file. That is a real property of the artifact, so it is printed on
  // every run rather than recorded once in a pull request body, and it cannot
  // grow without somebody seeing the number change.
  const noticedCodes = new Set();
  for (const [, { rows }] of rowsByFile) {
    for (const row of rows) if (row.externalCopyrightNotice) noticedCodes.add(row.term.code);
  }
  for (const [fam, rows] of relationRows) {
    const refs = new Set();
    let rowCount = 0;
    for (const row of rows) {
      let hit = false;
      for (const node of [row.subject, row.object]) {
        if (node?.system !== "LOINC" || !noticedCodes.has(node.code)) continue;
        refs.add(node.code);
        hit = true;
      }
      // Counted once per ROW: some rows carry a noticed code on both sides.
      if (hit) rowCount++;
    }
    if (refs.size === 0) {
      notes.push(`${fam}: references no code carrying a third-party copyright notice`);
    } else {
      notes.push(
        `${fam}: ${rowCount} row(s) reference ${refs.size} code(s) carrying a third-party copyright notice, whose notice travels on the term row, not here: ${[...refs].sort().join(", ")}`,
      );
    }
  }

  // --- integrity: each .meta.json hash matches its file --------------------
  for (const f of files) {
    const metaPath = join(termsDir, `${f.name}.meta.json`);
    if (!existsSync(metaPath)) {
      errors.push(`${f.name}: no ${f.name}.meta.json, so the term table carries no file-level provenance`);
      continue;
    }
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    const sha = createHash("sha256").update(readFileSync(f.path)).digest("hex");
    if (sha !== meta.sha256) {
      errors.push(`${f.name}.jsonl: sha256 ${sha} != ${f.name}.meta.json ${meta.sha256}`);
    }
    const rows = rowsByFile.get(f.name).rows.length;
    if (meta.rows !== rows) {
      errors.push(`${f.name}.jsonl: ${rows} rows != ${f.name}.meta.json rows ${meta.rows}`);
    }
  }

  // --- checks 2 and 3: need the release ------------------------------------
  if (!releaseDir || !existsSync(releaseDir)) {
    notes.push(
      "LOINC release absent ($LOINC_RELEASE_DIR): the external-copyright-notice check and the byte-equality check against the release were SKIPPED, not passed",
    );
    return { ok: errors.length === 0, checked, notes, errors };
  }

  // Check against the PINNED release or not at all: pointed at a different
  // version, every term LOINC has since renamed reads as a Section 2 violation.
  assertReleaseVersion(releaseDir, SOURCE_VERSIONS.loinc);

  const table = TERM_TABLES[0];
  const sourceColumns = table.loincColumns.filter((c) => c !== "ConsumerName");
  const source = new Map();
  forEachCsvRecord(join(releaseDir, "LoincTable", "Loinc.csv"), (get) => {
    const code = get("LOINC_NUM");
    if (!code || !terms.has(code)) return;
    const rec = {};
    for (const c of sourceColumns) rec[c] = get(c);
    source.set(code, rec);
  });
  const consumerNames = new Map();
  forEachCsvRecord(join(releaseDir, "AccessoryFiles", "ConsumerName", "ConsumerName.csv"), (get) => {
    const code = get("LoincNumber");
    if (code && terms.has(code)) consumerNames.set(code, get("ConsumerName"));
  });

  for (const [code, { row, where }] of terms) {
    const rec = source.get(code);
    if (!rec) {
      errors.push(`${where}: LOINC ${code} is not in the ${releaseDirLabel(releaseDir)} release table`);
      continue;
    }
    // check 2: a notice in the source record must ship with the row, verbatim.
    const notice = rec.EXTERNAL_COPYRIGHT_NOTICE;
    if (notice && row.externalCopyrightNotice !== notice) {
      errors.push(
        `${where} (${code}): source record carries an EXTERNAL_COPYRIGHT_NOTICE, and the row ${row.externalCopyrightNotice ? "carries a different one" : "carries none"}`,
      );
    }
    if (!notice && row.externalCopyrightNotice) {
      errors.push(`${where} (${code}): row carries an externalCopyrightNotice the source record does not have`);
    }
    // check 3: every loinc value byte-equal to the release, both directions.
    // An empty source field is omitted, never emitted as an empty string.
    for (const c of table.loincColumns) {
      const want = c === "ConsumerName" ? consumerNames.get(code) || "" : rec[c];
      const got = row.loinc?.[c];
      if (want === "") {
        if (got !== undefined) {
          errors.push(`${where} (${code}): loinc.${c} is "${got}" but the source field is empty (empty fields are omitted)`);
        }
        continue;
      }
      if (got === undefined) {
        errors.push(`${where} (${code}): loinc.${c} is missing but the source record has "${want}"`);
      } else if (got !== want) {
        errors.push(`${where} (${code}): loinc.${c} is "${got}" but the release says "${want}" (LOINC values are never edited)`);
      }
    }
    // The display itself is a LOINC value and is checked the same way. A
    // displayField naming a column the release does not have is a FAILURE, not a
    // skipped comparison: an unverifiable display that passes is worse than one
    // that fails, because it looks checked.
    const wantDisplay = rec[row.term?.displayField];
    if (wantDisplay === undefined) {
      errors.push(
        `${where} (${code}): term.displayField "${row.term?.displayField}" names no column carried from the release, so the display cannot be verified`,
      );
    } else if (row.term?.display !== wantDisplay) {
      errors.push(`${where} (${code}): term.display is "${row.term?.display}" but ${row.term?.displayField} in the release is "${wantDisplay}"`);
    }
  }

  // check 3, continued: the LOINC displays carried by the relation families.
  for (const [fam, rows] of relationRows) {
    rows.forEach((row, i) => {
      const where = `${fam}.jsonl:${i + 1}`;
      for (const [side, node] of [["subject", row.subject], ["object", row.object]]) {
        if (node?.system !== "LOINC") continue;
        const want = source.get(node.code)?.LONG_COMMON_NAME;
        if (want === undefined) continue; // check 5 already reported this code
        if (node.display !== want) {
          errors.push(`${where} ${side} (${node.code}): display is "${node.display}" but LONG_COMMON_NAME in the release is "${want}"`);
        }
      }
    });
  }

  // The Group Name is the licensed string that must travel with a Group id.
  const groupNames = new Map();
  forEachCsvRecord(join(releaseDir, "AccessoryFiles", "GroupFile", "Group.csv"), (get) => {
    const id = get("GroupId");
    if (id) groupNames.set(id, get("Group"));
  });
  for (const [fam, rows] of relationRows) {
    rows.forEach((row, i) => {
      for (const [side, node] of [["subject", row.subject], ["object", row.object]]) {
        if (node?.system !== "LOINC-GROUP") continue;
        const want = groupNames.get(node.code);
        if (want === undefined) {
          errors.push(`${fam}.jsonl:${i + 1} ${side}: ${node.code} is not in the release Group file`);
        } else if (node.display !== want) {
          errors.push(`${fam}.jsonl:${i + 1} ${side} (${node.code}): display is "${node.display}" but the release Group Name is "${want}"`);
        }
      }
    });
  }

  notes.push(`byte-equality checked against the release for ${terms.size} term rows and every LOINC display in ${relationRows.size} relation families`);
  return { ok: errors.length === 0, checked, notes, errors };
}

function releaseDirLabel(dir) {
  return String(dir).split("/").filter(Boolean).pop() || dir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = validateLoincLicense();
  console.log(`loinc-license: checked ${r.checked} rows, ${r.errors.length} violations`);
  for (const n of r.notes) console.log("  note: " + n);
  for (const e of r.errors.slice(0, 50)) console.log("  " + e);
  process.exit(r.ok ? 0 : 1);
}
