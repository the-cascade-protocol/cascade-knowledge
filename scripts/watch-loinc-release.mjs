#!/usr/bin/env node
// @ts-check
/**
 * Watch for a new LOINC release and open one issue when there is one.
 *
 * LOINC ships roughly twice a year, not monthly, and its download is gated on a
 * human accepting the current license version (5.8 was presented to registered
 * users on 2026-09-15). So the download is deliberately NOT automated: what is
 * automated is noticing, and the issue this opens carries the checklist.
 *
 * Two probes, in order of authority:
 *
 *   1. fhir.loinc.org, with Basic auth from the LOINC_USER / LOINC_PASSWORD
 *      secrets. Authoritative: it is LOINC's own server.
 *   2. tx.fhir.org, unauthenticated, when those secrets are absent. This is a
 *      LAGGING signal and says so: on 2026-09-15 it reported 2.82 while 2.83
 *      had been out since August. Useful as a floor, never as a guarantee.
 *
 * Exits 0 whether or not a new release exists; a new release is reported by
 * opening an issue, not by failing the job. Exits non-zero only when the probe
 * itself could not produce a version, because a watcher that cannot see
 * upstream must not report "up to date".
 *
 * Usage: node scripts/watch-loinc-release.mjs [--dry-run]
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const DRY_RUN = process.argv.includes("--dry-run");

/** Parse "2.83" into [2, 83] for ordering. Returns null if it is not a version. */
function parseVersion(v) {
  if (typeof v !== "string") return null;
  const m = /^(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function isNewer(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return false;
  return pa[0] > pb[0] || (pa[0] === pb[0] && pa[1] > pb[1]);
}

/** The LOINC release this repository is built from, or null if none is pinned. */
function pinnedVersion() {
  const p = join(REPO_ROOT, "sources", "SOURCE_VERSIONS.json");
  const json = JSON.parse(readFileSync(p, "utf8"));
  return typeof json.loinc === "string" ? json.loinc : null;
}

/** Every LOINC CodeSystem version a FHIR terminology server reports. */
async function versionsFrom(url, headers) {
  const res = await fetch(url, { headers: { Accept: "application/fhir+json", ...headers } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const bundle = await res.json();
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];
  return entries
    .map((e) => e?.resource?.version)
    .filter((v) => parseVersion(v) !== null);
}

async function probe() {
  const user = process.env.LOINC_USER;
  const pass = process.env.LOINC_PASSWORD;
  if (user && pass) {
    const auth = Buffer.from(`${user}:${pass}`).toString("base64");
    const versions = await versionsFrom(
      "https://fhir.loinc.org/CodeSystem?url=http://loinc.org&_summary=true",
      { Authorization: `Basic ${auth}` },
    );
    if (versions.length === 0) throw new Error("fhir.loinc.org returned no parseable LOINC version");
    return { source: "fhir.loinc.org", lagging: false, versions };
  }
  const versions = await versionsFrom(
    "https://tx.fhir.org/r4/CodeSystem?url=http://loinc.org&_summary=true",
    {},
  );
  if (versions.length === 0) throw new Error("tx.fhir.org returned no parseable LOINC version");
  return { source: "tx.fhir.org", lagging: true, versions };
}

function latest(versions) {
  return versions.reduce((best, v) => (best === null || isNewer(v, best) ? v : best), null);
}

const ISSUE_LABEL = "loinc-release";

async function gh(path, init) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required to file an issue");
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function issueBody(upstream, pinned, source, lagging) {
  return [
    `LOINC **${upstream}** is available upstream. This repository ${pinned ? `is built from **${pinned}**` : "pins no LOINC release yet"}.`,
    "",
    `Detected from \`${source}\`${lagging ? " (an unauthenticated mirror that LAGS the real release; the true version may be newer still)" : ""}.`,
    "",
    "The download is not automated on purpose: Regenstrief gates it on a signed-in human accepting the current license version, and a license version change is exactly when a person should read it.",
    "",
    "## Checklist",
    "",
    "- [ ] Sign in at https://loinc.org and accept the current license version if prompted. Note the version number.",
    "- [ ] Download the full release and unpack it into the terminology release directory (outside every git checkout).",
    "- [ ] `export LOINC_RELEASE_DIR=/path/to/Loinc_<version>`",
    "- [ ] If the license version changed, replace `LICENSE-LOINC.txt` with the release's own `LoincLicense_<x.y>.txt` (byte-identical copy) and update the version named in `LICENSE-NOTICES.md`.",
    "- [ ] Rebuild: `node scripts/build-loinc-terms.mjs` (writes `terms/`), then `node scripts/validate-all.mjs`.",
    "- [ ] Bump `loinc` in `sources/SOURCE_VERSIONS.json` to the new release.",
    "- [ ] Review the diff against the release's own `AccessoryFiles/ChangeSnapshot/` and `Updates/` files, which say what actually changed.",
    "- [ ] Check the status-regression report: any code we ship whose `STATUS` became DEPRECATED or DISCOURAGED needs a decision, not a silent carry-forward.",
    "- [ ] Open the PR.",
    "",
    "Closing this issue without doing the above is fine if the release is being skipped deliberately; say which and why, so the next watcher run is not a surprise.",
  ].join("\n");
}

async function main() {
  // The pin is read BEFORE the probe, so that an unpinned repository needs no
  // network at all: nothing can be compared, so nothing should be fetched, and
  // the check stays offline-testable.
  const pinned = pinnedVersion();
  if (pinned === null) {
    console.log("pinned here   : (none yet)");
    console.log("No LOINC release is pinned in sources/SOURCE_VERSIONS.json yet, so there is nothing to compare.");
    console.log("This watcher starts reporting the moment the LOINC build lands and adds that pin.");
    return;
  }

  const { source, lagging, versions } = await probe();
  const upstream = latest(versions);
  console.log(`upstream LOINC: ${upstream} (from ${source}${lagging ? ", lagging" : ""}; saw ${versions.join(", ")})`);
  console.log(`pinned here   : ${pinned}`);
  if (!isNewer(upstream, pinned)) {
    console.log("Up to date. No issue opened.");
    return;
  }

  const title = `LOINC ${upstream} is available (this repository is built from ${pinned})`;
  if (DRY_RUN) {
    console.log(`[dry-run] would open: ${title}`);
    console.log(issueBody(upstream, pinned, source, lagging));
    return;
  }

  const existing = await gh(`/issues?state=open&labels=${ISSUE_LABEL}&per_page=100`);
  if (existing.some((i) => i.title === title)) {
    console.log("An open issue for this release already exists. Nothing to do.");
    return;
  }
  const assignees = (process.env.LOINC_WATCH_ASSIGNEES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const issue = await gh("/issues", {
    method: "POST",
    body: JSON.stringify({
      title,
      body: issueBody(upstream, pinned, source, lagging),
      labels: [ISSUE_LABEL],
      ...(assignees.length > 0 ? { assignees } : {}),
    }),
  });
  console.log(`Opened ${issue.html_url}`);
}

main().catch((err) => {
  console.error(`LOINC release watch FAILED: ${err.message}`);
  console.error("A watcher that cannot see upstream must not report 'up to date'.");
  process.exit(1);
});
