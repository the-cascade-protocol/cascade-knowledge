// Phase 3: tiered review-cadence sweep. Lists curated rows whose reviewedDate
// is past its horizon (candidate: quarterly / 90d; established: annually /
// 365d). A maintenance report, not a data emitter, so it may use the current
// date (overridable with --as-of YYYY-MM-DD for reproducible runs).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { FAMILIES } from "./lib/families.mjs";
import { readJsonl } from "./lib/canonical.mjs";
import { DATA_DIR } from "./lib/paths.mjs";

const HORIZON_DAYS = { candidate: 90, established: 365 };

function daysBetween(a, b) {
  return Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function reviewSweep(asOf = new Date().toISOString().slice(0, 10)) {
  const overdue = [];
  let curatedTotal = 0;
  for (const f of FAMILIES) {
    const p = join(DATA_DIR, `${f.name}.jsonl`);
    if (!existsSync(p)) continue;
    for (const row of readJsonl(p)) {
      const prov = row.provenance;
      if (prov.method !== "curated") continue;
      curatedTotal++;
      const horizon = HORIZON_DAYS[prov.evidenceTier] ?? 365;
      const age = daysBetween(prov.reviewedDate, asOf);
      if (age > horizon) {
        overdue.push({
          family: f.name,
          tier: prov.evidenceTier,
          reviewedDate: prov.reviewedDate,
          ageDays: age,
          horizon,
          subject: row.subject.display,
          object: row.object.display,
        });
      }
    }
  }
  overdue.sort((a, b) => b.ageDays - a.ageDays);
  return { asOf, curatedTotal, overdueCount: overdue.length, overdue };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--as-of");
  const asOf = i >= 0 ? process.argv[i + 1] : undefined;
  const r = reviewSweep(asOf);
  console.log(`review-sweep as of ${r.asOf}: ${r.overdueCount} of ${r.curatedTotal} curated rows overdue`);
  for (const o of r.overdue.slice(0, 50)) {
    console.log(`  ${o.family} [${o.tier}] reviewed ${o.reviewedDate} (${o.ageDays}d > ${o.horizon}d): ${o.subject} -> ${o.object}`);
  }
}
