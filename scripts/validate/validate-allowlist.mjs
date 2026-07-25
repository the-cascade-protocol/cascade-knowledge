// Validator: open-source allowlist proof (the structural UMLS/SNOMED wall).
//
// Every committed row must cite a `source` that is on the open allowlist, and
// every subject/object code system must be an open system and must NOT be a
// walled system. A single walled code (e.g. SNOMED-CT) anywhere fails the build.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FAMILIES } from "../lib/families.mjs";
import { readJsonl } from "../lib/canonical.mjs";
import { DATA_DIR, SOURCES_DIR } from "../lib/paths.mjs";

export function validateAllowlist(dataDir = DATA_DIR) {
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
