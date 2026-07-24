import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  iterateAssociations,
  parseAssociationBlock,
  mapNamespace,
  toDrugConditionRow,
  decodeEntities,
} from "../scripts/lib/medrt.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "medrt-sample.xml");
const xml = readFileSync(FIX, "utf8");
const lines = xml.split("\n");

const makeProv = () => ({
  source: "med-rt",
  sourceVersion: "2026.01.05",
  method: "derived",
  evidenceTier: "established",
  citation: "https://example.org/",
  addedDate: "2026-07-24",
  reviewedDate: "2026-07-24",
});

test("parseAssociationBlock takes the FIRST name, ignoring qualifier <name>", () => {
  const block = [
    "<namespace>MED-RT</namespace>",
    "<name>may_treat</name>",
    "<from_namespace>RxNorm</from_namespace>",
    "<from_name>x</from_name>",
    "<from_code>1</from_code>",
    "<to_namespace>MeSH</to_namespace>",
    "<to_name>y</to_name>",
    "<to_code>M1</to_code>",
    "<name>Authority</name>",
  ];
  assert.equal(parseAssociationBlock(block).name, "may_treat");
});

test("mapNamespace walls SNOMED CT and unknowns", () => {
  assert.equal(mapNamespace("RxNorm"), "RXNORM");
  assert.equal(mapNamespace("MeSH"), "MESH");
  assert.equal(mapNamespace("MED-RT"), "MED-RT");
  assert.equal(mapNamespace("SNOMED CT"), null);
});

test("decodeEntities handles ampersand and numeric entities", () => {
  assert.equal(decodeEntities("Alpha &amp; Beta &#40;x&#41;"), "Alpha & Beta (x)");
});

test("fixture yields exactly the 2 clean may_treat/may_prevent rows", () => {
  const rows = [];
  for (const a of iterateAssociations(lines)) {
    const { row } = toDrugConditionRow(a, makeProv);
    if (row) rows.push(row);
  }
  // 5 associations: 1 valid may_treat, 1 SNOMED-subject (dropped),
  // 1 SNOMED-object (dropped), 1 valid may_prevent, 1 induces (dropped).
  assert.equal(rows.length, 2);
  const preds = rows.map((r) => r.predicate).sort();
  assert.deepEqual(preds, ["may_prevent", "may_treat"]);
  for (const r of rows) {
    assert.equal(r.object.system, "MESH");
    assert.equal(r.subject.system, "RXNORM");
    assert.notEqual(r.subject.system, "SNOMED-CT");
  }
});

test("SNOMED-bearing associations are dropped with a wall reason", () => {
  const assocs = [...iterateAssociations(lines)];
  const snomedSubject = assocs.find((a) => a.fromNamespace === "SNOMED CT");
  const snomedObject = assocs.find((a) => a.toNamespace === "SNOMED CT");
  assert.match(toDrugConditionRow(snomedSubject, makeProv).reason, /walled-or-unsupported-subject/);
  assert.match(toDrugConditionRow(snomedObject, makeProv).reason, /walled-or-unsupported-object/);
});
