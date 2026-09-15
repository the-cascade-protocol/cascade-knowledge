// Validator: every committed row conforms to its schema.
//
// Both artifact kinds. Iterating FAMILIES alone would generate
// schema/loinc-term.schema.json and then apply it to nothing, which is how a
// term row with a walled system, an unpinned loinc column and a stray top-level
// key would pass the whole suite.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { FAMILIES, TERM_TABLES } from "../lib/families.mjs";
import { readJsonl } from "../lib/canonical.mjs";
import { validate } from "../lib/schema-validator.mjs";
import { DATA_DIR, TERMS_DIR, SCHEMA_DIR } from "../lib/paths.mjs";

export function validateSchema(dataDir = DATA_DIR, termsDir = TERMS_DIR) {
  const errors = [];
  let checked = 0;
  for (const t of TERM_TABLES) {
    const schemaPath = join(SCHEMA_DIR, `${t.name}.schema.json`);
    for (const name of t.files) {
      const p = join(termsDir, `${name}.jsonl`);
      if (!existsSync(p)) continue;
      readJsonl(p).forEach((row, i) => {
        checked++;
        for (const e of validate(row, schemaPath)) {
          errors.push(`${name}.jsonl:${i + 1} ${e}`);
        }
      });
    }
  }
  for (const f of FAMILIES) {
    const dataPath = join(dataDir, `${f.name}.jsonl`);
    if (!existsSync(dataPath)) continue;
    const schemaPath = join(SCHEMA_DIR, `${f.name}.schema.json`);
    const rows = readJsonl(dataPath);
    rows.forEach((row, i) => {
      checked++;
      for (const e of validate(row, schemaPath)) {
        errors.push(`${f.name}.jsonl:${i + 1} ${e}`);
      }
    });
  }
  return { ok: errors.length === 0, checked, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = validateSchema();
  console.log(`schema: checked ${r.checked} rows, ${r.errors.length} errors`);
  for (const e of r.errors.slice(0, 50)) console.log("  " + e);
  process.exit(r.ok ? 0 : 1);
}
