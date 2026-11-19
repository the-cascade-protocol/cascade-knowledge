import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonl } from "../scripts/lib/canonical.mjs";
import {
  parseComponentStrength,
  parsePrefix,
  splitProductName,
} from "../scripts/lib/product-strength.mjs";
import { releaseDateFrom, pickRrfDir } from "../scripts/prepare-rxnorm-prescribable.mjs";
import { validateSchema } from "../scripts/validate/validate-schema.mjs";
import { validateAllowlist } from "../scripts/validate/validate-allowlist.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(REPO, "test", "fixtures", "rxnorm");

function build(outDir) {
  return JSON.parse(
    execFileSync("node", [join(REPO, "scripts/build/build-rxnorm-prescribable.mjs")], {
      env: { ...process.env, RXNORM_PRESCRIBE_RRF: FIX, KNOWLEDGE_DATA_DIR: outDir },
      encoding: "utf8",
    }),
  );
}

test("parseComponentStrength keeps the decimal and the unit verbatim", () => {
  assert.deepEqual(parseComponentStrength("faketamol 100 MG"), { value: "100", unit: "MG" });
  assert.deepEqual(parseComponentStrength("placebide 0.5 MG/ML"), { value: "0.5", unit: "MG/ML" });
  assert.deepEqual(parseComponentStrength("x y 0.09 MG/ACTUAT"), { value: "0.09", unit: "MG/ACTUAT" });
  assert.equal(parseComponentStrength("faketamol"), null);
});

test("parsePrefix reads a release period and a quantity, and nothing else", () => {
  assert.deepEqual(parsePrefix(""), {});
  assert.deepEqual(parsePrefix("24 HR"), { releasePeriod: { value: "24", unit: "HR" } });
  assert.deepEqual(parsePrefix("0.4 ML"), { quantity: { value: "0.4", unit: "ML" } });
  assert.deepEqual(parsePrefix("1 ML 12 HR"), {
    quantity: { value: "1", unit: "ML" },
    releasePeriod: { value: "12", unit: "HR" },
  });
  assert.equal(parsePrefix("Extra"), null);
  assert.equal(parsePrefix("24 HR 12 HR"), null);
});

test("splitProductName reads a combination name against its components and form", () => {
  const r = splitProductName(
    "faketamol 32 MG/ML / placebide 0.5 MG/ML Oral Solution",
    ["placebide 0.5 MG/ML", "faketamol 32 MG/ML"],
    "Oral Solution",
  );
  assert.deepEqual(r, {
    order: ["faketamol 32 MG/ML", "placebide 0.5 MG/ML"],
    prefix: "",
    formText: "Oral Solution",
  });
  // A form the structure does not state is a mismatch, never a guess.
  assert.deepEqual(
    splitProductName("faketamol 100 MG Oral Capsule", ["faketamol 100 MG"], "Oral Tablet"),
    { error: "dose-form-mismatch" },
  );
  // A component that does not sit on word boundaries does not match.
  assert.equal(
    splitProductName("faketamol 100 MG Oral Tablet", ["faketamol 10"], undefined).error,
    "name-structure-mismatch",
  );
});

test("product-strength build: SCD and SBD rows from the fabricated fixture", () => {
  const out = mkdtempSync(join(tmpdir(), "ck-ps-"));
  try {
    const summary = build(out);
    assert.equal(summary["product-strength"], 5);
    assert.deepEqual(summary["product-strength-skipped"], {
      "sbd-name-mismatch": 1,
      "scd-dose-form-mismatch": 1,
      "scd-no-components": 1,
    });
    const rows = readJsonl(join(out, "product-strength.jsonl"));
    const by = Object.fromEntries(rows.map((r) => [r.product.code, r]));

    // A plain single-ingredient tablet.
    assert.deepEqual(by["9000020"].product, {
      system: "RXNORM", code: "9000020", display: "faketamol 100 MG Oral Tablet", tty: "SCD",
    });
    assert.deepEqual(by["9000020"].components, [{
      component: { system: "RXNORM", code: "9000050", display: "faketamol 100 MG" },
      ingredient: { system: "RXNORM", code: "9000001", display: "faketamol" },
      strength: { value: "100", unit: "MG" },
    }]);
    assert.deepEqual(by["9000020"].doseForm, { system: "RXNORM", code: "9000040", display: "Oral Tablet" });

    // Extended release: the release period, and the precise ingredient.
    assert.deepEqual(by["9000021"].releasePeriod, { value: "24", unit: "HR" });
    assert.equal(by["9000021"].components[0].ingredient.code, "9000002");
    assert.equal(by["9000021"].components[0].preciseIngredient.code, "9000003");
    assert.equal(by["9000021"].doseForm.display, "Extended Release Oral Tablet");

    // A combination keeps both components in name order, decimals verbatim.
    assert.deepEqual(
      by["9000022"].components.map((c) => [c.ingredient.code, c.strength.value, c.strength.unit]),
      [["9000001", "32", "MG/ML"], ["9000004", "0.5", "MG/ML"]],
    );

    // A quantified product carries its quantity.
    assert.deepEqual(by["9000023"].quantity, { value: "0.4", unit: "ML" });

    // The branded drug maps to its clinical drug and copies its strengths.
    assert.equal(by["9000060"].product.tty, "SBD");
    assert.equal(by["9000060"].clinicalDrug.code, "9000020");
    assert.equal(by["9000060"].brand.code, "9000010");
    assert.deepEqual(by["9000060"].components, by["9000020"].components);

    // Excluded: a non-RXNORM atom, a product with no structure, a form mismatch.
    for (const code of ["9000024", "9000025", "9000026", "9000061"]) {
      assert.equal(by[code], undefined, `${code} must not be emitted`);
    }
    assert.ok(!readFileSync(join(out, "product-strength.jsonl"), "utf8").includes("MTHSPL"));

    // The output passes the same schema and open-allowlist gates as committed data.
    const schema = validateSchema(out, join(out, "no-terms"));
    assert.equal(schema.ok, true, schema.errors.join("\n"));
    const allow = validateAllowlist(out, join(out, "no-terms"));
    assert.equal(allow.ok, true, allow.errors.join("\n"));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("product-strength build is byte-identical across runs", () => {
  const a = mkdtempSync(join(tmpdir(), "ck-ps-a-"));
  const b = mkdtempSync(join(tmpdir(), "ck-ps-b-"));
  try {
    build(a);
    build(b);
    const x = readFileSync(join(a, "product-strength.jsonl"));
    const y = readFileSync(join(b, "product-strength.jsonl"));
    assert.ok(x.length > 0);
    assert.ok(x.equals(y));
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("product-strength schema rejects a float strength and a walled system", () => {
  const out = mkdtempSync(join(tmpdir(), "ck-ps-bad-"));
  try {
    build(out);
    const path = join(out, "product-strength.jsonl");
    const row = readJsonl(path)[0];
    row.components[0].strength.value = 0.5;
    row.doseForm.system = "SNOMED-CT";
    writeFileSync(path, JSON.stringify(row) + "\n");
    assert.equal(validateSchema(out, join(out, "no-terms")).ok, false);
    const allow = validateAllowlist(out, join(out, "no-terms"));
    assert.equal(allow.ok, false);
    assert.ok(allow.errors.some((e) => e.includes("WALLED") && e.includes("doseForm")));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// --- The regeneration workflow's release preparation ------------------------

test("releaseDateFrom reads the readme title, then a dated file name", () => {
  assert.equal(releaseDateFrom("RxNorm 01/05/2026 Current Prescribable Content"), "2026-01-05");
  assert.equal(releaseDateFrom("", ["Readme_full_prescribe_11032026.txt"]), "2026-11-03");
  assert.equal(releaseDateFrom("no date here", ["RXNCONSO.RRF"]), null);
});

test("pickRrfDir prefers the prescribe/rrf directory when several exist", () => {
  assert.equal(pickRrfDir(["/x/rrf/RXNCONSO.RRF"]), "/x/rrf");
  assert.equal(
    pickRrfDir(["/x/rrf/RXNCONSO.RRF", "/x/prescribe/rrf/RXNCONSO.RRF"]),
    "/x/prescribe/rrf",
  );
  assert.throws(() => pickRrfDir([]));
});

test("prepare refuses a release whose RXNCONSO carries a non-RXNORM source", () => {
  // The fabricated fixture deliberately carries one MTHSPL atom.
  const script = join(REPO, "scripts/prepare-rxnorm-prescribable.mjs");
  assert.throws(
    () => execFileSync("node", [script, FIX], { encoding: "utf8", stdio: "pipe" }),
    (e) => /non-RXNORM sources \(MTHSPL\)/.test(String(e.stderr)),
  );
  // The same files with the foreign atom removed pass, and the RRF dir prints.
  const clean = mkdtempSync(join(tmpdir(), "ck-prep-"));
  try {
    const rrf = join(clean, "prescribe", "rrf");
    mkdirSync(rrf, { recursive: true });
    const conso = readFileSync(join(FIX, "RXNCONSO.RRF"), "utf8")
      .split("\n").filter((l) => !l.includes("|MTHSPL|")).join("\n");
    writeFileSync(join(rrf, "RXNCONSO.RRF"), conso);
    writeFileSync(join(rrf, "RXNREL.RRF"), readFileSync(join(FIX, "RXNREL.RRF")));
    const out = execFileSync("node", [script, clean], { encoding: "utf8", stdio: "pipe" });
    assert.equal(out.trim(), rrf);
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }
});
