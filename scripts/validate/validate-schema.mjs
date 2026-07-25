// Validator: every committed row conforms to its family JSON Schema.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { FAMILIES } from "../lib/families.mjs";
import { readJsonl } from "../lib/canonical.mjs";
import { validate } from "../lib/schema-validator.mjs";
import { DATA_DIR, SCHEMA_DIR } from "../lib/paths.mjs";

export function validateSchema(dataDir = DATA_DIR) {
  const errors = [];
  let checked = 0;
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
