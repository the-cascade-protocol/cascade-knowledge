// Phase 2, pipeline 2: regenerate drug may_treat / may_prevent condition rows
// DIRECTLY from the MED-RT Core XML release (US federal work, public domain).
//
// Does NOT reuse the M2 artifact or any build path whose input was the
// restricted full RxNorm release. Streams $MEDRT_XML line by line (the file is
// ~45MB). Rows whose drug or condition side is SNOMED CT (or otherwise walled)
// are dropped and counted, never emitted.

import { createReadStream, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { writeJsonl } from "../lib/canonical.mjs";
import { provenance } from "../lib/provenance.mjs";
import { DATA_DIR, INPUTS, requireInput } from "../lib/paths.mjs";
import { parseAssociationBlock, toDrugConditionRow } from "../lib/medrt.mjs";

export async function run() {
  const xml = requireInput(INPUTS.medrtXml, "MED-RT Core XML ($MEDRT_XML)");
  mkdirSync(DATA_DIR, { recursive: true });

  const makeProv = () =>
    provenance("med-rt", { method: "derived", evidenceTier: "established" });

  const rows = [];
  const excluded = new Map();
  const bump = (reason) => {
    const key = reason.split(":")[0];
    excluded.set(key, (excluded.get(key) || 0) + 1);
  };

  const rl = createInterface({
    input: createReadStream(xml, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let block = null; // collected inner lines of the current <association>
  for await (const line of rl) {
    if (line.includes("<association>")) {
      block = [];
      continue;
    }
    if (line.includes("</association>")) {
      if (block) {
        const a = parseAssociationBlock(block);
        const { row, reason } = toDrugConditionRow(a, makeProv);
        if (row) rows.push(row);
        else if (reason) bump(reason);
      }
      block = null;
      continue;
    }
    if (block) block.push(line);
  }

  const count = writeJsonl(join(DATA_DIR, "drug-condition.jsonl"), rows);
  return { "drug-condition": count, _excluded: Object.fromEntries(excluded) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((s) => console.log(JSON.stringify(s, null, 2)));
}
