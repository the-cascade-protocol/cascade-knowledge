// The LOINC pin, the term-row canonical form, and the release-independent half
// of the license validator. No network and no LOINC release needed.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SOURCE_VERSIONS, CITATIONS } from "../scripts/lib/provenance.mjs";
import { serializeTermRow } from "../scripts/lib/canonical.mjs";
import { TERM_TABLE_BY_NAME, OPEN_CODE_SYSTEMS, FAMILY_BY_NAME } from "../scripts/lib/families.mjs";
import { validateLoincLicense } from "../scripts/validate/validate-loinc-license.mjs";
import { loadNoticeVerdicts } from "../scripts/lib/loinc.mjs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { FIXTURE_RELEASE } from "./loinc.test.mjs";

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

test("displayField names only fields that EXIST as columns in Loinc.csv", () => {
  // An enum value the release has no column for cannot be verified: the
  // byte-equality check would look it up, find undefined, and silently skip the
  // display comparison, so a row with a completely wrong display would pass.
  const t = TERM_TABLE_BY_NAME["loinc-term"];
  assert.deepEqual(t.displayFields, ["LONG_COMMON_NAME", "SHORTNAME", "DisplayName"]);
  for (const f of t.displayFields) {
    assert.ok(t.loincColumns.includes(f), `${f} must be carried from the release to be checkable`);
  }
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

test("a duplicate term.code is an error, within a table and across tables", () => {
  const terms = scratch();
  const data = scratch();
  try {
    writeTerms(terms, [GOOD_TERM, { ...GOOD_TERM, loinc: { LONG_COMMON_NAME: "A different display" } }]);
    const r = validateLoincLicense({ termsDir: terms, dataDir: data, releaseDir: "" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("already emitted") && e.includes("one row per code")));
  } finally {
    rmSync(terms, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

test("an empty terms/ does NOT wave through committed relation rows", () => {
  // The state this guards is a terms/ that failed to build or was not committed.
  // Returning ok because there is nothing to compare against would leave every
  // LOINC reference in the relation families unbacked and unreported.
  const terms = scratch();
  const data = scratch();
  try {
    writeFileSync(
      join(data, "lab-panel.jsonl"),
      JSON.stringify({
        subject: { system: "LOINC", code: "1-1", display: "A display" },
        predicate: "has_member",
        object: { system: "LOINC", code: "2-2", display: "Another" },
        provenance: {
          source: "loinc", sourceVersion: "2.83", method: "derived", evidenceTier: "established",
          citation: "https://loinc.org/", addedDate: "2026-09-15", reviewedDate: "2026-09-15",
        },
      }) + "\n",
    );
    const r = validateLoincLicense({ termsDir: terms, dataDir: data, releaseDir: "" });
    assert.equal(r.ok, false, "an empty terms/ with committed relation rows must FAIL");
    assert.ok(r.errors.some((e) => e.includes("no term tables") && e.includes("unbacked")));
  } finally {
    rmSync(terms, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

test("with neither term tables nor relation families, there is genuinely nothing to check", () => {
  const terms = scratch();
  const data = scratch();
  try {
    const r = validateLoincLicense({ termsDir: terms, dataDir: data, releaseDir: "" });
    assert.equal(r.ok, true);
    assert.ok(r.notes.some((n) => n.includes("nothing to check")));
  } finally {
    rmSync(terms, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

// --- checks 2 and 3, against the synthetic mini-release ---------------------
//
// These two are the checks that need a release, and until now they had no
// automated test at all: every other case passes releaseDir:"" and takes the
// skip path. The fixture makes them permanent tests rather than a one-time
// observation in a pull request body.

const FIXTURE_PLAIN = {
  term: {
    system: "LOINC",
    code: "99991-1",
    display: "Fictional analyte [Mass/volume] in Serum or Plasma",
    displayField: "LONG_COMMON_NAME",
  },
  loinc: {
    LONG_COMMON_NAME: "Fictional analyte [Mass/volume] in Serum or Plasma",
    SHORTNAME: "Fict SerPl-mCnc",
    DisplayName: "Fictional [Mass/Vol]",
    CLASS: "CHEM",
    CLASSTYPE: "1",
    STATUS: "ACTIVE",
    EXAMPLE_UCUM_UNITS: "mg/dL",
    COMMON_TEST_RANK: "7",
    COMMON_ORDER_RANK: "0",
    ConsumerName: "Fictional test, blood",
  },
  cascade: {},
};

const FIXTURE_NOTICED = {
  term: {
    system: "LOINC",
    code: "99992-9",
    display: "Fictional panel, extended [Presence] in Blood",
    displayField: "LONG_COMMON_NAME",
  },
  externalCopyrightNotice:
    'Copyright (c) 2026 Nobody, Inc. The "Fictional" mark is used with permission.',
  loinc: {
    LONG_COMMON_NAME: "Fictional panel, extended [Presence] in Blood",
    SHORTNAME: "Fict pnl Bld",
    CLASS: "HEM/BC",
    CLASSTYPE: "1",
    STATUS: "ACTIVE",
    COMMON_TEST_RANK: "0",
    COMMON_ORDER_RANK: "0",
    EXTERNAL_COPYRIGHT_NOTICE:
      'Copyright (c) 2026 Nobody, Inc. The "Fictional" mark is used with permission.',
    EXTERNAL_COPYRIGHT_LINK: "https://example.invalid/notice",
  },
  cascade: {},
};

const FIXTURE_VERDICTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures", "loinc", "notice-verdicts.json",
);

function againstFixture(rows) {
  const terms = scratch();
  const data = scratch();
  try {
    writeTerms(terms, rows);
    return validateLoincLicense({
      termsDir: terms,
      dataDir: data,
      releaseDir: FIXTURE_RELEASE,
      verdictsPath: FIXTURE_VERDICTS,
    });
  } finally {
    rmSync(terms, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
}

test("checks 2 and 3 pass on rows that match the release exactly", () => {
  const r = againstFixture([FIXTURE_PLAIN, FIXTURE_NOTICED]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.ok(r.notes.some((n) => n.includes("byte-equality checked against the release")));
});

test("check 2: dropping a notice the source record carries is caught", () => {
  const { externalCopyrightNotice, ...stripped } = FIXTURE_NOTICED;
  const r = againstFixture([stripped]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("EXTERNAL_COPYRIGHT_NOTICE") && e.includes("carries none")));
});

test("check 2: altering a notice by one character is caught", () => {
  const r = againstFixture([
    { ...FIXTURE_NOTICED, externalCopyrightNotice: FIXTURE_NOTICED.externalCopyrightNotice.replace("2026", "2025") },
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("carries a different one")));
});

test("check 3: editing a LOINC value is caught", () => {
  const r = againstFixture([
    { ...FIXTURE_PLAIN, loinc: { ...FIXTURE_PLAIN.loinc, STATUS: "DEPRECATED" } },
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("loinc.STATUS") && e.includes("LOINC values are never edited")));
});

test("check 3: emitting an empty source field as \"\" is caught, not just a wrong value", () => {
  // The omit-when-empty convention is half the byte-equality contract; without
  // this direction a row could carry every LOINC key with empty values and pass.
  const r = againstFixture([
    { ...FIXTURE_PLAIN, loinc: { ...FIXTURE_PLAIN.loinc, EXTERNAL_COPYRIGHT_LINK: "" } },
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("EXTERNAL_COPYRIGHT_LINK")));
});

test("check 3: dropping a non-empty LOINC value is caught", () => {
  const { ConsumerName, ...withoutConsumer } = FIXTURE_PLAIN.loinc;
  const r = againstFixture([{ ...FIXTURE_PLAIN, loinc: withoutConsumer }]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("loinc.ConsumerName") && e.includes("missing")));
});

test("check 3: a display that does not match its own displayField is caught", () => {
  const r = againstFixture([
    { ...FIXTURE_PLAIN, term: { ...FIXTURE_PLAIN.term, display: "Something else entirely" } },
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("term.display is") && e.includes("LONG_COMMON_NAME")));
});

test("a displayField naming no carried column FAILS rather than skipping the comparison", () => {
  const r = againstFixture([
    {
      ...FIXTURE_PLAIN,
      term: { ...FIXTURE_PLAIN.term, display: "Wrong", displayField: "FULLY_SPECIFIED_NAME" },
    },
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("names no column carried from the release")));
});

test("the licence validator refuses a release that is not the pinned one", () => {
  const terms = scratch();
  const data = scratch();
  const wrong = join(scratch(), "Loinc_2.84");
  try {
    mkdirSync(wrong, { recursive: true });
    writeTerms(terms, [FIXTURE_PLAIN]);
    // A release that EXISTS but is the wrong version is the dangerous case: it
    // would report every term LOINC has since renamed as a Section 2 violation.
    assert.throws(
      () => validateLoincLicense({ termsDir: terms, dataDir: data, releaseDir: wrong }),
      /release mismatch/,
    );
  } finally {
    rmSync(terms, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
    rmSync(wrong, { recursive: true, force: true });
  }
});

// --- the notice chokepoint --------------------------------------------------

test("every notice verdict is one of the two allowed values, and none is duplicated", () => {
  const v = loadNoticeVerdicts();
  assert.ok(v.size > 0);
  for (const e of v.values()) {
    assert.ok(["permissive", "restricted"].includes(e.verdict));
    assert.ok(e.holder && e.holder.length > 0, "every verdict names a holder");
    assert.ok(e.reason && e.reason.length > 0, "every verdict carries a reason a person can audit");
  }
});

test("a notice with no human verdict FAILS rather than defaulting into either bucket", () => {
  // The whole point of an exact-match table over a regex: a notice nobody has
  // ruled on cannot be guessed at, in either direction.
  const terms = scratch();
  const data = scratch();
  try {
    writeTerms(terms, [
      {
        ...GOOD_TERM,
        externalCopyrightNotice: "Copyright (c) 2027 An Instrument Vendor Invented Next Release. Terms apply.",
      },
    ]);
    const r = validateLoincLicense({ termsDir: terms, dataDir: data, releaseDir: "" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("no verdict in sources/loinc-notice-verdicts.json")));
    assert.ok(r.errors.some((e) => e.includes("An Instrument Vendor Invented Next Release")));
  } finally {
    rmSync(terms, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

test("a notice ruled restricted must never appear in emitted output", () => {
  const v = loadNoticeVerdicts();
  const restricted = [...v.values()].find((e) => e.verdict === "restricted");
  assert.ok(restricted, "the fixture for this test is the real verdict file");
  const terms = scratch();
  const data = scratch();
  try {
    writeTerms(terms, [{ ...GOOD_TERM, externalCopyrightNotice: restricted.notice }]);
    const r = validateLoincLicense({ termsDir: terms, dataDir: data, releaseDir: "" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes('ruled "restricted"') && e.includes("withheld, not emitted")));
  } finally {
    rmSync(terms, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

test("the licence validator reports which relation rows reference a noticed code", () => {
  // Printed on every run, because a relation row has nowhere to carry a notice
  // and that exposure must not be able to grow silently.
  const r = validateLoincLicense({ releaseDir: "" });
  assert.ok(
    r.notes.some((n) => n.startsWith("lab-panel:") && n.includes("copyright notice")),
    "lab-panel's noticed-code exposure must be reported every run",
  );
});
