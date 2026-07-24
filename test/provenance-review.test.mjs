import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILD_DATE, provenance } from "../scripts/lib/provenance.mjs";
import { reviewSweep } from "../scripts/review-sweep.mjs";

test("provenance dates are the fixed BUILD_DATE constant (no wall-clock)", () => {
  const p = provenance("med-rt", { method: "derived", evidenceTier: "established" });
  assert.equal(p.addedDate, BUILD_DATE);
  assert.equal(p.reviewedDate, BUILD_DATE);
  assert.equal(p.sourceVersion, "2026.01.05");
});

test("provenance throws for an unpinned source", () => {
  assert.throws(() => provenance("not-a-source", { method: "curated", evidenceTier: "established" }));
});

test("review-sweep: nothing overdue at build date, everything curated overdue far in the future", () => {
  const atBuild = reviewSweep(BUILD_DATE);
  assert.ok(atBuild.curatedTotal > 0);
  assert.equal(atBuild.overdueCount, 0);

  const future = reviewSweep("2030-01-01");
  assert.equal(future.overdueCount, future.curatedTotal);
});
