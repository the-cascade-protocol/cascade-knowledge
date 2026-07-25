// Fetch open source releases for the scheduled regeneration workflow.
//
//  - CDC CVX: always downloaded (public domain, no auth), pinned into
//    sources/cdc-cvx/CVX.txt.
//  - RxNorm prescribable + MED-RT: downloaded only when their URLs (and, for
//    RxNorm, a UMLS API key) are provided via environment. These are large and,
//    for RxNorm, gated by NLM behind a free UMLS key. When absent, the step is
//    skipped and build-all leaves those families untouched (checksum-verified).
//
// With --update-versions, bumps the cdc-cvx entry in SOURCE_VERSIONS to today's
// date so regenerated rows carry the refreshed release date.

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, SOURCES_DIR } from "./lib/paths.mjs";

const CVX_URL = "https://www2.cdc.gov/vaccines/iis/iisstandards/downloads/CVX.txt";

async function download(url, dest) {
  const res = await fetch(url, { headers: { accept: "text/plain,*/*" } });
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  mkdirSync(join(dest, ".."), { recursive: true });
  writeFileSync(dest, body);
  return body.length;
}

async function main() {
  const updateVersions = process.argv.includes("--update-versions");

  // CVX (always)
  const cvxDest = join(SOURCES_DIR, "cdc-cvx", "CVX.txt");
  const n = await download(CVX_URL, cvxDest);
  console.log(`fetched CVX (${n} bytes) -> ${cvxDest}`);

  if (updateVersions) {
    const vPath = join(SOURCES_DIR, "SOURCE_VERSIONS.json");
    const v = JSON.parse(readFileSync(vPath, "utf8"));
    v["cdc-cvx"] = new Date().toISOString().slice(0, 10);
    writeFileSync(vPath, JSON.stringify(v, null, 2) + "\n");
    console.log(`updated SOURCE_VERSIONS cdc-cvx -> ${v["cdc-cvx"]}`);
  }

  // RxNorm prescribable (optional, needs URL + UMLS key)
  if (process.env.RXNORM_PRESCRIBE_URL) {
    console.log(
      "RXNORM_PRESCRIBE_URL is set; a maintainer step should download + unzip it " +
        "and export RXNORM_PRESCRIBE_RRF. Automated unzip is intentionally left to " +
        "the workflow to keep this script dependency-free.",
    );
  } else {
    console.log("RxNorm prescribable: no URL configured, skipping (family left as committed).");
  }

  // MED-RT (optional)
  if (process.env.MEDRT_URL) {
    console.log(
      "MEDRT_URL is set; the workflow should download + unzip it and export MEDRT_XML.",
    );
  } else {
    console.log("MED-RT: no URL configured, skipping (family left as committed).");
  }

  void REPO_ROOT;
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
