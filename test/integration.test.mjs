import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonl } from "../scripts/lib/canonical.mjs";
import { validateSchema } from "../scripts/validate/validate-schema.mjs";
import { validateAllowlist } from "../scripts/validate/validate-allowlist.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(REPO, "test", "fixtures");

function runBuild(script, env) {
  execFileSync("node", [join(REPO, script)], { env: { ...process.env, ...env }, encoding: "utf8" });
}

test("RxNorm prescribable build classifies brand/generic and ingredient by TTY (fabricated fixture)", () => {
  const out = mkdtempSync(join(tmpdir(), "ck-rxn-"));
  try {
    runBuild("scripts/build/build-rxnorm-prescribable.mjs", {
      RXNORM_PRESCRIBE_RRF: join(FIX, "rxnorm"),
      KNOWLEDGE_DATA_DIR: out,
    });
    const bg = readJsonl(join(out, "brand-generic.jsonl"));
    const ir = readJsonl(join(out, "ingredient-rollup.jsonl"));
    assert.equal(bg.length, 1, "one brand->generic (obsolete + non-RXNORM rows excluded)");
    assert.equal(bg[0].subject.code, "9000010"); // brand
    assert.equal(bg[0].object.code, "9000001"); // generic ingredient
    assert.equal(ir.length, 1);
    assert.equal(ir[0].subject.code, "9000020"); // product
    assert.equal(ir[0].object.code, "9000001"); // ingredient
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("MED-RT build emits only clean may_treat/may_prevent rows (fabricated fixture)", () => {
  const out = mkdtempSync(join(tmpdir(), "ck-medrt-"));
  try {
    runBuild("scripts/build/build-drug-condition-medrt.mjs", {
      MEDRT_XML: join(FIX, "medrt-sample.xml"),
      KNOWLEDGE_DATA_DIR: out,
    });
    const rows = readJsonl(join(out, "drug-condition.jsonl"));
    assert.equal(rows.length, 2);
    for (const r of rows) assert.notEqual(r.object.system, "SNOMED-CT");
    assert.ok(!JSON.stringify(rows).includes("9000005"), "SNOMED object code must not appear");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("allowlist validator catches a committed SNOMED-CT (walled) row", () => {
  const out = mkdtempSync(join(tmpdir(), "ck-wall-"));
  try {
    const provenance = {
      source: "med-rt",
      sourceVersion: "2026.01.05",
      method: "derived",
      evidenceTier: "established",
      citation: "https://example.org/",
      addedDate: "2026-07-24",
      reviewedDate: "2026-07-24",
    };
    const walled = {
      subject: { system: "RXNORM", code: "1", display: "x" },
      predicate: "may_treat",
      object: { system: "SNOMED-CT", code: "22298006", display: "MI" },
      provenance,
    };
    writeFileSync(join(out, "drug-condition.jsonl"), JSON.stringify(walled) + "\n");
    const r = validateAllowlist(out);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("WALLED")));
    // schema also rejects it via the object system enum
    assert.equal(validateSchema(out).ok, false);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("allowlist validator catches an unlisted source", () => {
  const out = mkdtempSync(join(tmpdir(), "ck-src-"));
  try {
    const row = {
      subject: { system: "LOINC", code: "2345-7", display: "Glucose" },
      predicate: "monitors",
      object: { system: "ICD-10-CM", code: "E11", display: "T2DM" },
      provenance: {
        source: "some-walled-source",
        sourceVersion: "1",
        method: "curated",
        evidenceTier: "established",
        citation: "https://example.org/",
        addedDate: "2026-07-24",
        reviewedDate: "2026-07-24",
      },
    };
    writeFileSync(join(out, "lab-condition.jsonl"), JSON.stringify(row) + "\n");
    const r = validateAllowlist(out);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("not on the open allowlist")));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
