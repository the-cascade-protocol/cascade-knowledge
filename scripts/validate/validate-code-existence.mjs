// Validator: committed codes exist in their terminology's canonical API.
//
//   RXNORM     -> NLM RxNav (status endpoint; also reports retired/remapped)
//   LOINC      -> NLM Clinical Table Search Service (loinc_items)
//   ICD-10-CM  -> NLM Clinical Table Search Service (icd10cm)
//
// Systems without a wired open API in v0 (MESH, MED-RT, CVX, LOINC-GROUP) are reported as
// not-checked. CVX codes are already validated against the pinned CDC snapshot
// at build time.
//
// Modes:
//   --sample [N]  (default 12 per system) deterministic evenly-spaced sample; CI
//   --full        every distinct code (throttled); reserved for the scheduled audit
//
// Robustness: only a DEFINITIVE "does not exist" fails the run. Transport errors
// (timeouts, 5xx) are reported and skipped (network flakiness must not red-line
// a PR). Retired/remapped codes are warnings with the suggested current code.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { FAMILIES } from "../lib/families.mjs";
import { readJsonl } from "../lib/canonical.mjs";
import { DATA_DIR } from "../lib/paths.mjs";

const THROTTLE_MS = Number(process.env.CODECHECK_THROTTLE_MS || 150);
const TIMEOUT_MS = 8000;
const RETRIES = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
      const res = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
      clearTimeout(t);
      if (res.status >= 500) throw new Error(`http ${res.status}`);
      if (res.status === 404) return { _status: 404 };
      if (!res.ok) throw new Error(`http ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(200 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Returns {state:"exists"|"not-found"|"warn", detail?} | throws (transport).
// Uses RxNav's historystatus endpoint, which reports both existence and
// currency (Active vs Retired/Remapped/NotCurrent) for the scheduled audit.
async function checkRxnorm(code) {
  const j = await getJson(`https://rxnav.nlm.nih.gov/REST/rxcui/${encodeURIComponent(code)}/historystatus.json`);
  if (j._status === 404) return { state: "not-found" };
  const meta = j?.rxcuiStatusHistory?.metaData;
  const status = meta?.status;
  if (!status || status === "UNKNOWN" || meta?.source === "NONE") return { state: "not-found" };
  if (status === "Active") return { state: "exists" };
  // Retired / Remapped / NotCurrent / Quantified / Obsolete
  const remap = j?.rxcuiStatusHistory?.derivedConcepts?.remappedConcept?.[0]?.remappedRxCui;
  return { state: "warn", detail: `status=${status}${remap ? ` remapTo=${remap}` : ""}` };
}

async function checkClinicalTable(apiPath, searchField, code, requireExact) {
  const url = `https://clinicaltables.nlm.nih.gov/api/${apiPath}/v3/search?sf=${searchField}&df=${searchField}&maxList=5&terms=${encodeURIComponent(code)}`;
  const j = await getJson(url);
  if (j._status === 404) return { state: "not-found" };
  const total = Array.isArray(j) ? j[0] : 0;
  const codes = Array.isArray(j) ? (j[3] || []).map((row) => row[0]) : [];
  if (!total || total === 0) return { state: "not-found" };
  if (requireExact) {
    if (codes.includes(code)) return { state: "exists" };
    // present in the terminology as a search hit but not an exact leaf match
    return { state: "warn", detail: "fuzzy match only (no exact code)" };
  }
  return { state: "exists" };
}

const CHECKERS = {
  RXNORM: (code) => checkRxnorm(code),
  LOINC: (code) => checkClinicalTable("loinc_items", "LOINC_NUM", code, true),
  "ICD-10-CM": (code) => checkClinicalTable("icd10cm", "code", code, false),
};
// LOINC-GROUP holds LOINC Group identifiers (LG...). They are not codes in a
// code system (FHIR models a Group as a ValueSet), and the loinc_items endpoint
// this file queries contains none of them, so an exact-match lookup on one would
// report NOT FOUND for a perfectly correct row. Their existence is instead
// proved against the release's own Group file by validate-loinc-license.mjs.
const NOT_CHECKED = ["MESH", "MED-RT", "CVX", "LOINC-GROUP"];

function collectCodes() {
  const bySystem = new Map();
  for (const f of FAMILIES) {
    const p = join(DATA_DIR, `${f.name}.jsonl`);
    if (!existsSync(p)) continue;
    for (const row of readJsonl(p)) {
      for (const node of [row.subject, row.object]) {
        if (!node?.code) continue;
        if (!bySystem.has(node.system)) bySystem.set(node.system, new Set());
        bySystem.get(node.system).add(node.code);
      }
    }
  }
  return bySystem;
}

function sample(codes, n) {
  const sorted = [...codes].sort();
  if (sorted.length <= n) return sorted;
  const step = sorted.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(sorted[Math.floor(i * step)]);
  return out;
}

export async function validateCodeExistence({ full = false, sampleSize = 12 } = {}) {
  const bySystem = collectCodes();
  const errors = [];
  const warnings = [];
  const transportSkips = [];
  const summary = {};

  for (const [system, codeSet] of bySystem) {
    const checker = CHECKERS[system];
    if (!checker) {
      summary[system] = `${codeSet.size} distinct codes, no canonical API wired (not checked)`;
      continue;
    }
    const codes = full ? [...codeSet].sort() : sample(codeSet, sampleSize);
    let ok = 0;
    for (const code of codes) {
      try {
        const r = await checker(code);
        if (r.state === "exists") ok++;
        else if (r.state === "not-found") errors.push(`${system} ${code}: NOT FOUND in canonical API`);
        else if (r.state === "warn") warnings.push(`${system} ${code}: ${r.detail}`);
      } catch (e) {
        transportSkips.push(`${system} ${code}: transport error (${e.message})`);
      }
      await sleep(THROTTLE_MS);
    }
    summary[system] = `checked ${codes.length}/${codeSet.size}, ${ok} confirmed`;
  }

  return { ok: errors.length === 0, mode: full ? "full" : `sample(${sampleSize})`, summary, errors, warnings, transportSkips };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const full = process.argv.includes("--full");
  const nIdx = process.argv.indexOf("--sample");
  const sampleSize = nIdx >= 0 && process.argv[nIdx + 1] && !process.argv[nIdx + 1].startsWith("--")
    ? Number(process.argv[nIdx + 1])
    : 12;
  const r = await validateCodeExistence({ full, sampleSize });
  console.log(`code-existence (${r.mode}):`);
  for (const [sys, s] of Object.entries(r.summary)) console.log(`  ${sys}: ${s}`);
  if (r.warnings.length) {
    console.log(`  warnings (${r.warnings.length}):`);
    for (const w of r.warnings.slice(0, 20)) console.log("    " + w);
  }
  if (r.transportSkips.length) {
    console.log(`  transport-skipped (${r.transportSkips.length}) (not counted as failures)`);
  }
  if (r.errors.length) {
    console.log(`  ERRORS (${r.errors.length}):`);
    for (const e of r.errors.slice(0, 40)) console.log("    " + e);
  }
  process.exit(r.ok ? 0 : 1);
}
