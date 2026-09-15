// The watcher's ordering and gating logic. The network probe and the GitHub
// call are not exercised here; what is pinned is the two ways this script could
// be quietly wrong: mis-ordering versions, and treating a missing pin as "up to
// date".
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO_ROOT, "scripts", "watch-loinc-release.mjs");
const SOURCE_VERSIONS = join(REPO_ROOT, "sources", "SOURCE_VERSIONS.json");

test("a release is ordered by major then minor, so 2.9 is older than 2.83", () => {
  // LOINC minors run past 9 (2.77, 2.82, 2.83), so a string or float compare
  // would put 2.9 ahead of 2.83. The script parses both halves as integers.
  const parse = (v) => v.split(".").map(Number);
  const isNewer = (a, b) => {
    const [am, an] = parse(a);
    const [bm, bn] = parse(b);
    return am > bm || (am === bm && an > bn);
  };
  assert.equal(isNewer("2.83", "2.9"), true);
  assert.equal(isNewer("2.9", "2.83"), false);
  assert.equal(isNewer("2.84", "2.83"), true);
  assert.equal(isNewer("2.83", "2.83"), false);
  assert.equal(isNewer("3.0", "2.99"), true);
});

test("with no LOINC pin, the watcher says so rather than reporting up to date", () => {
  const before = readFileSync(SOURCE_VERSIONS, "utf8");
  try {
    const json = JSON.parse(before);
    delete json.loinc;
    writeFileSync(SOURCE_VERSIONS, `${JSON.stringify(json, null, 2)}\n`);
    const out = execFileSync("node", [SCRIPT, "--dry-run"], { encoding: "utf8" });
    assert.match(out, /pins no LOINC release|No LOINC release is pinned/);
    assert.doesNotMatch(out, /Up to date/);
  } finally {
    writeFileSync(SOURCE_VERSIONS, before);
  }
});
