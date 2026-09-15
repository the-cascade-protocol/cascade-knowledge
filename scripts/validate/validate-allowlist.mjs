// Validator: open-source allowlist proof (the structural UMLS/SNOMED wall).
//
// Every committed row must cite a `source` that is on the open allowlist, and
// every code system must be an open system and must NOT be a walled system. A
// single walled code (e.g. SNOMED-CT) anywhere fails the build.
//
// This covers BOTH artifact kinds. A term row carries its system in term.system
// and its source in the file-level .meta.json rather than per row, but the wall
// is the same wall: it is the proof that nothing license-walled is committed,
// and an artifact kind outside it is an artifact kind with no proof.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FAMILIES, TERM_TABLES } from "../lib/families.mjs";
import { readJsonl } from "../lib/canonical.mjs";
import { DATA_DIR, TERMS_DIR, SOURCES_DIR } from "../lib/paths.mjs";

export function validateAllowlist(dataDir = DATA_DIR, termsDir = TERMS_DIR) {
  const allowlist = JSON.parse(
    readFileSync(join(SOURCES_DIR, "allowlist.json"), "utf8"),
  );
  const openSources = new Set(Object.keys(allowlist.sources));
  const openSystems = new Set(allowlist.openCodeSystems);
  const walledSystems = new Set(allowlist.walledCodeSystems);

  const errors = [];
  let checked = 0;

  const checkSystem = (sys, where) => {
    if (walledSystems.has(sys)) {
      errors.push(`${where}: WALLED code system "${sys}" must never be committed`);
    } else if (!openSystems.has(sys)) {
      errors.push(`${where}: code system "${sys}" is not on the open allowlist`);
    }
  };

  for (const t of TERM_TABLES) {
    for (const name of t.files) {
      const p = join(termsDir, `${name}.jsonl`);
      if (!existsSync(p)) continue;
      // File-level provenance: the source is stated once, so it is checked once.
      const metaPath = join(termsDir, `${name}.meta.json`);
      if (!existsSync(metaPath)) {
        errors.push(`${name}.jsonl: no ${name}.meta.json, so the file cites no source at all`);
      } else {
        const meta = JSON.parse(readFileSync(metaPath, "utf8"));
        if (!openSources.has(meta.provenance?.source)) {
          errors.push(`${name}.meta.json: source "${meta.provenance?.source}" not on the open allowlist`);
        }
      }
      readJsonl(p).forEach((row, i) => {
        checked++;
        checkSystem(row.term?.system, `${name}.jsonl:${i + 1} term`);
      });
    }
  }

  for (const f of FAMILIES) {
    const dataPath = join(dataDir, `${f.name}.jsonl`);
    if (!existsSync(dataPath)) continue;
    const rows = readJsonl(dataPath);
    rows.forEach((row, i) => {
      checked++;
      const where = `${f.name}.jsonl:${i + 1}`;
      if (!openSources.has(row.provenance?.source)) {
        errors.push(`${where}: source "${row.provenance?.source}" not on the open allowlist`);
      }
      checkSystem(row.subject?.system, where + " subject");
      checkSystem(row.object?.system, where + " object");
    });
  }
  return { ok: errors.length === 0, checked, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = validateAllowlist();
  console.log(`allowlist: checked ${r.checked} rows, ${r.errors.length} violations`);
  for (const e of r.errors.slice(0, 50)) console.log("  " + e);
  process.exit(r.ok ? 0 : 1);
}
