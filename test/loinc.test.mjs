// Unit tests for the LOINC release reader and its forbidden-input wall.
// No network, no release required: the CSV fixture is synthetic.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  forEachCsvRecord,
  readCsvColumns,
  isForbiddenInput,
  assertInputAllowed,
  ForbiddenInputError,
  FORBIDDEN_INPUT_BASENAMES,
} from "../scripts/lib/loinc.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "loinc", "sample.csv");

test("the CSV reader handles the release dialect: quotes, commas, escaped quotes, line breaks", () => {
  const rows = readCsvColumns(FIXTURE, ["CODE", "NAME", "NOTE", "RANK"]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { CODE: "1-1", NAME: "plain value", NOTE: "", RANK: "3" });
  assert.equal(rows[1].NAME, "value, with a comma");
  assert.equal(rows[1].NOTE, 'quoted "inner" quotes');
  assert.equal(rows[2].NAME, "value\nwith a line break");
  assert.equal(rows[2].RANK, "");
});

test("an unknown column is an error rather than a silent empty string", () => {
  assert.throws(
    () => forEachCsvRecord(FIXTURE, (get) => get("NO_SUCH_COLUMN")),
    /column "NO_SUCH_COLUMN" is not in sample.csv/,
  );
});

test("every forbidden LOINC input is refused by basename, wherever it sits", () => {
  for (const name of FORBIDDEN_INPUT_BASENAMES) {
    assert.equal(isForbiddenInput(`/any/where/${name}`), true, `${name} must be refused`);
  }
  // LoincAnswerListLink.csv ships in two places in the release; both are walled.
  assert.equal(isForbiddenInput("/r/AccessoryFiles/AnswerFile/LoincAnswerListLink.csv"), true);
  assert.equal(isForbiddenInput("/r/AccessoryFiles/PanelsAndForms/LoincAnswerListLink.csv"), true);
  // The linguistic variants are one file per language under a varying name.
  assert.equal(isForbiddenInput("/r/AccessoryFiles/LinguisticVariants/zhCN10LinguisticVariant.csv"), true);
  assert.equal(isForbiddenInput("/r/AccessoryFiles/LinguisticVariants/frCA8LinguisticVariant.csv"), true);
});

test("the five files this pipeline actually reads are allowed", () => {
  for (const name of [
    "Loinc.csv",
    "ConsumerName.csv",
    "PanelsAndForms.csv",
    "Group.csv",
    "GroupLoincTerms.csv",
  ]) {
    assert.equal(isForbiddenInput(`/r/${name}`), false, `${name} must be readable`);
    assert.doesNotThrow(() => assertInputAllowed(`/r/${name}`));
  }
});

test("the reader itself refuses a forbidden path, so the wall cannot be walked around", () => {
  // The tripwire is in the reader, not only in the builder: a future change that
  // grows a new read gets stopped here rather than shipping restricted content.
  assert.throws(() => forEachCsvRecord("/r/LoincTable/Part.csv", () => {}), ForbiddenInputError);
  assert.throws(() => forEachCsvRecord("/r/AnswerList.csv", () => {}), /forbidden LOINC input/);
  // And it refuses BEFORE touching the filesystem: these paths do not exist, and
  // the error is the wall's, not ENOENT.
  assert.throws(() => forEachCsvRecord("/r/DocumentOntology.csv", () => {}), (e) => e.forbiddenInput === true);
});
