import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCvx } from "../scripts/lib/cvx.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "cvx-sample.txt");

test("parseCvx trims padded codes and reads the short description as display", () => {
  const idx = parseCvx(FIX);
  assert.ok(idx.has("03"));
  assert.equal(idx.get("03").display, "MMR");
  assert.ok(idx.has("999"));
  assert.equal(idx.get("999").status, "Active");
  assert.equal(idx.has(" 03 "), false); // codes are trimmed keys
});
