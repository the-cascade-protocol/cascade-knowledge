// Unit tests for the LOINC release reader and its input wall.
// No network. The fixture is a synthetic three-file mini-release using
// fabricated 9999x codes, not an extract of the real release.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  forEachCsvRecord,
  readCsvColumns,
  isForbiddenInput,
  isAllowedInput,
  assertInputAllowed,
  assertReleaseVersion,
  ForbiddenInputError,
  ALLOWED_INPUT_BASENAMES,
  FORBIDDEN_INPUT_BASENAMES,
} from "../scripts/lib/loinc.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_RELEASE = join(HERE, "fixtures", "loinc", "Loinc_2.83");
const TABLE = join(FIXTURE_RELEASE, "LoincTable", "Loinc.csv");

test("the CSV reader handles the release dialect: quotes, commas, escaped quotes, line breaks", () => {
  const rows = readCsvColumns(TABLE, ["LOINC_NUM", "LONG_COMMON_NAME", "SHORTNAME", "EXTERNAL_COPYRIGHT_NOTICE"]);
  assert.equal(rows.length, 4);
  // A comma inside a quoted display.
  assert.equal(rows[1].LONG_COMMON_NAME, "Fictional panel, extended [Presence] in Blood");
  // An escaped quote inside a quoted notice.
  assert.equal(
    rows[1].EXTERNAL_COPYRIGHT_NOTICE,
    'Copyright (c) 2026 Nobody, Inc. The "Fictional" mark is used with permission.',
  );
  // A line break inside a quoted notice: the record does not end there.
  assert.equal(rows[2].EXTERNAL_COPYRIGHT_NOTICE, "Copyright (c) 2026 Nobody, Inc.\nAll rights reserved.");
  assert.equal(rows[2].SHORTNAME, "");
});

test("an unknown column is an error rather than a silent empty string", () => {
  assert.throws(
    () => forEachCsvRecord(TABLE, (get) => get("NO_SUCH_COLUMN")),
    /column "NO_SUCH_COLUMN" is not in Loinc.csv/,
  );
});

test("the input wall is an ALLOWLIST: exactly five files are readable", () => {
  assert.equal(ALLOWED_INPUT_BASENAMES.length, 5);
  for (const name of ALLOWED_INPUT_BASENAMES) {
    assert.equal(isAllowedInput(`/any/where/${name}`), true, `${name} must be readable`);
    assert.doesNotThrow(() => assertInputAllowed(`/any/where/${name}`));
  }
});

test("an unlisted release file is refused even though nothing names it", () => {
  // This is the point of an allowlist: the release ships dozens of accessory
  // files and grows more every version, so a denylist only stops the ones
  // somebody thought of. None of these is on the forbidden list either.
  for (const name of [
    "LoincUniversalLabOrdersValueSet.csv",
    "LoincIeeeMedicalDeviceCodeMappingTable.csv",
    "ImagingDocuments.csv",
    "SomethingLoincShipsIn2_90.csv",
    "loinc.xml",
  ]) {
    assert.equal(isAllowedInput(`/r/${name}`), false, `${name} must be refused`);
    assert.throws(() => assertInputAllowed(`/r/${name}`), ForbiddenInputError);
  }
});

test("every known-restricted file is still refused, wherever it sits", () => {
  for (const name of FORBIDDEN_INPUT_BASENAMES) {
    assert.equal(isForbiddenInput(`/any/where/${name}`), true, `${name} must be refused`);
  }
  // LoincAnswerListLink.csv ships in two places in the release; both are walled.
  assert.equal(isForbiddenInput("/r/AccessoryFiles/AnswerFile/LoincAnswerListLink.csv"), true);
  assert.equal(isForbiddenInput("/r/AccessoryFiles/PanelsAndForms/LoincAnswerListLink.csv"), true);
  // The linguistic variants are one file per language under a varying name.
  assert.equal(isForbiddenInput("/r/AccessoryFiles/LinguisticVariants/zhCN10LinguisticVariant.csv"), true);
});

test("the reader itself refuses, before touching the filesystem", () => {
  // The tripwire is in the reader, not only in the builder: a future change that
  // grows a new read gets stopped here rather than shipping restricted content.
  // These paths do not exist, and the error is the wall's, not ENOENT.
  assert.throws(() => forEachCsvRecord("/r/LoincTable/Part.csv", () => {}), ForbiddenInputError);
  assert.throws(() => forEachCsvRecord("/r/AnswerList.csv", () => {}), /not on the allowlist/);
  assert.throws(() => forEachCsvRecord("/r/DocumentOntology.csv", () => {}), (e) => e.forbiddenInput === true);
});

test("the release directory must be the pinned release", () => {
  assert.equal(assertReleaseVersion("/x/Loinc_2.83", "2.83"), "2.83");
  assert.equal(assertReleaseVersion("/x/Loinc_2.83/", "2.83"), "2.83");
  // A newer release would report every renamed LOINC term as a Section 2
  // violation, which is a confusing way to learn the wrong directory was used.
  assert.throws(() => assertReleaseVersion("/x/Loinc_2.84", "2.83"), /release mismatch.*2\.84.*pins 2\.83/s);
  // A directory whose version cannot be read is refused rather than assumed.
  assert.throws(() => assertReleaseVersion("/x/loinc-latest", "2.83"), /cannot tell which LOINC release/);
});
