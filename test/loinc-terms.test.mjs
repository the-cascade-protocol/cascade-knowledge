// The LOINC pin, the term-row canonical form, and the release-independent half
// of the license validator. No network and no LOINC release needed.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SOURCE_VERSIONS, CITATIONS } from "../scripts/lib/provenance.mjs";
import { serializeTermRow } from "../scripts/lib/canonical.mjs";
import { TERM_TABLE_BY_NAME, OPEN_CODE_SYSTEMS, FAMILY_BY_NAME } from "../scripts/lib/families.mjs";
import { validateLoincLicense } from "../scripts/validate/validate-loinc-license.mjs";

const COLUMNS = TERM_TABLE_BY_NAME["loinc-term"].loincColumns;

test("the LOINC release is pinned as a bare major.minor string the watcher can read", () => {
  // The spelling is load-bearing: watch-loinc-release.mjs reads json.loinc and
  // accepts only /^\d+\.\d+$/, so "LOINC" or "2.83 (Aug 2026)" would leave the
  // watcher silently idle instead of reporting a new release.
  assert.equal(SOURCE_VERSIONS.loinc, "2.83");
  assert.match(SOURCE_VERSIONS.loinc, /^\d+\.\d+$/);
  assert.equal(typeof CITATIONS.loinc, "string");
  assert.match(CITATIONS.loinc, /^https:\/\//);
});

test("a LOINC Group id ships in its own code system, not as a LOINC code", () => {
  assert.ok(OPEN_CODE_SYSTEMS.includes("LOINC-GROUP"));
  assert.deepEqual(FAMILY_BY_NAME["lab-group"].subjectSystems, ["LOINC-GROUP"]);
  assert.deepEqual(FAMILY_BY_NAME["lab-group"].objectSystems, ["LOINC"]);
  assert.deepEqual(FAMILY_BY_NAME["lab-panel"].subjectSystems, ["LOINC"]);
});

test("the loinc block carries exactly the 12 pinned columns, never all 40", () => {
  assert.equal(COLUMNS.length, 12);
  assert.ok(COLUMNS.includes("LONG_COMMON_NAME"));
  assert.ok(COLUMNS.includes("ConsumerName"));
  // A column that is in Loinc.csv but deliberately not shipped.
  assert.ok(!COLUMNS.includes("RELATEDNAMES2"));
  assert.ok(!COLUMNS.includes("DefinitionDescription"));
});

test("a term row has fixed key order and omits empty source fields entirely", () => {
  const line = serializeTermRow(
    {
      // Deliberately out of order, to prove the serializer imposes the order.
      term: { display: "D", code: "1-1", displayField: "LONG_COMMON_NAME", system: "LOINC" },
      loinc: { STATUS: "ACTIVE", LONG_COMMON_NAME: "D", SHORTNAME: "", DisplayName: undefined },
      cascade: {},
    },
    COLUMNS,
  );
  assert.equal(
    line,
    '{"term":{"system":"LOINC","code":"1-1","display":"D","displayField":"LONG_COMMON_NAME"},'
      + '"loinc":{"LONG_COMMON_NAME":"D","STATUS":"ACTIVE"},"cascade":{}}',
  );
  // An empty field is omitted, never emitted as "": the byte-equality validator
  // has to know which convention it is checking.
  assert.ok(!line.includes('"SHORTNAME"'));
  assert.ok(!line.includes('"DisplayName"'));
});

test("an external copyright notice is first-class on the row, before the loinc block", () => {
  const line = serializeTermRow(
    {
      term: { system: "LOINC", code: "1-1", display: "D", displayField: "LONG_COMMON_NAME" },
      externalCopyrightNotice: "Copyright someone else",
      loinc: { LONG_COMMON_NAME: "D" },
      cascade: {},
    },
    COLUMNS,
  );
  assert.ok(line.indexOf('"externalCopyrightNotice"') < line.indexOf('"loinc"'));
  assert.ok(line.includes('"externalCopyrightNotice":"Copyright someone else"'));
});

// --- the license validator, on synthetic rows -------------------------------

function scratch() {
  return mkdtempSync(join(tmpdir(), "ck-loinc-"));
}

function writeTerms(dir, rows, name = "loinc-lab") {
  const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(join(dir, `${name}.jsonl`), text);
  writeFileSync(
    join(dir, `${name}.meta.json`),
    JSON.stringify(
      {
        file: `${name}.jsonl`,
        provenance: { source: "loinc", sourceVersion: "2.83", method: "derived" },
        rows: rows.length,
        sha256: createHash("sha256").update(text).digest("hex"),
      },
      null,
      2,
    ) + "\n",
  );
}

const GOOD_TERM = {
  term: { system: "LOINC", code: "1-1", display: "A display", displayField: "LONG_COMMON_NAME" },
  loinc: { LONG_COMMON_NAME: "A display" },
  cascade: {},
};

test("with no release present, checks 2 and 3 skip AND SAY SO rather than passing quietly", () => {
  const terms = scratch();
  const data = scratch();
  try {
    writeTerms(terms, [GOOD_TERM]);
    const r = validateLoincLicense({ termsDir: terms, dataDir: data, releaseDir: "" });
    assert.equal(r.ok, true);
    assert.ok(
      r.notes.some((n) => n.includes("SKIPPED, not passed")),
      "the skip must be stated, not implied",
    );
  } finally {
    rmSync(terms, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

test("a row with a consumer name and no licensed display name is a failure", () => {
  const terms = scratch();
  const data = scratch();
  try {
    writeTerms(terms, [
      {
        term: { system: "LOINC", code: "1-1", display: "", displayField: "LONG_COMMON_NAME" },
        loinc: { ConsumerName: "Cholesterol, Blood" },
        cascade: {},
      },
    ]);
    const r = validateLoincLicense({ termsDir: terms, dataDir: data, releaseDir: "" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("no licensed display name")));
  } finally {
    rmSync(terms, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

test("a Part, Answer or AnswerList identifier cannot pass as a LOINC code", () => {
  const terms = scratch();
  const data = scratch();
  try {
    for (const bad of ["LP12345-6", "LA6113-0", "LL360-9"]) {
      writeTerms(terms, [
        { ...GOOD_TERM, term: { ...GOOD_TERM.term, code: bad } },
      ]);
      const r = validateLoincLicense({ termsDir: terms, dataDir: data, releaseDir: "" });
      assert.equal(r.ok, false, `${bad} must be rejected`);
      assert.ok(r.errors.some((e) => e.includes(bad) && e.includes("not a LOINC code")));
    }
  } finally {
    rmSync(terms, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

test("a relation row may not reference a code outside the emitted term tables", () => {
  const terms = scratch();
  const data = scratch();
  try {
    writeTerms(terms, [GOOD_TERM]);
    const prov = {
      source: "loinc",
      sourceVersion: "2.83",
      method: "derived",
      evidenceTier: "established",
      citation: "https://loinc.org/",
      addedDate: "2026-07-24",
      reviewedDate: "2026-07-24",
    };
    writeFileSync(
      join(data, "lab-panel.jsonl"),
      JSON.stringify({
        subject: { system: "LOINC", code: "1-1", display: "A display" },
        predicate: "has_member",
        object: { system: "LOINC", code: "9-9", display: "Not emitted" },
        provenance: prov,
      }) + "\n",
    );
    const r = validateLoincLicense({ termsDir: terms, dataDir: data, releaseDir: "" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("9-9") && e.includes("not in any emitted term table")));
  } finally {
    rmSync(terms, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

test("a term table whose meta.json hash does not match the file is an integrity failure", () => {
  const terms = scratch();
  const data = scratch();
  try {
    writeTerms(terms, [GOOD_TERM]);
    // Append a row without refreshing the meta: exactly what a hand-edit looks like.
    writeFileSync(
      join(terms, "loinc-lab.jsonl"),
      JSON.stringify(GOOD_TERM) + "\n" + JSON.stringify({ ...GOOD_TERM, term: { ...GOOD_TERM.term, code: "2-2" } }) + "\n",
    );
    const r = validateLoincLicense({ termsDir: terms, dataDir: data, releaseDir: "" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("sha256")));
  } finally {
    rmSync(terms, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});
