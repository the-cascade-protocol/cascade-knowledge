// Prepare an unpacked RxNorm Current Prescribable Content release for the
// build, in the scheduled regeneration workflow.
//
//   node scripts/prepare-rxnorm-prescribable.mjs <unzipped-dir> [--update-versions]
//
// Prints the directory holding RXNCONSO.RRF and RXNREL.RRF (the value for
// $RXNORM_PRESCRIBE_RRF) on stdout, and nothing else on stdout.
//
// THE WALL, CHECKED HERE RATHER THAN ASSUMED. The prescribable subset carries
// SAB=RXNORM atoms plus atoms from two unrestricted sources, MTHSPL (FDA
// Structured Product Labels) and MTHCMSFRF (the CMS Formulary Reference File);
// observed in the release of 2026-11. The full RxNorm release carries further
// sources (First Databank, Micromedex, Gold Standard and more) that are not
// ours to redistribute. So every RXNCONSO row is read and the run FAILS on any
// SAB outside PRESCRIBABLE_SABS, before any pipeline sees the files. A wrong
// download stops the build; it can never quietly become committed data. A
// source NLM newly adds to the subset also stops the build, on purpose: it
// gets a human look and a line here, never a default.
//
// The builders still read ONLY SAB=RXNORM rows (each filters on it literally);
// this list says which files are acceptable to open, not which rows are used.
//
// With --update-versions, the release date from the release's own readme
// ("RxNorm 01/05/2026 Current Prescribable Content", or a file name ending in
// _MMDDYYYY) is pinned as sources/SOURCE_VERSIONS.json "rxnorm-prescribable".
// A release whose date cannot be read fails the run rather than stamping new
// rows with the old version.

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { SOURCES_DIR } from "./lib/paths.mjs";
import { rrfRows, CONSO } from "./lib/rrf.mjs";

/** Every SAB the prescribable RXNCONSO is allowed to carry. See above. */
export const PRESCRIBABLE_SABS = new Set(["RXNORM", "MTHSPL", "MTHCMSFRF"]);

/** The SABs outside {@link PRESCRIBABLE_SABS}, sorted. Empty means acceptable. */
export function foreignSabs(sabs) {
  return [...sabs].filter((s) => !PRESCRIBABLE_SABS.has(s)).sort();
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** "MM/DD/YYYY" in readme text, or "_MMDDYYYY" in a file name -> "YYYY-MM-DD". */
export function releaseDateFrom(readmeText, fileNames = []) {
  const t = /RxNorm\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(readmeText || "");
  if (t) return `${t[3]}-${t[1]}-${t[2]}`;
  for (const n of fileNames) {
    const m = /_(\d{2})(\d{2})(\d{4})\.[A-Za-z]+$/.exec(n);
    if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  }
  return null;
}

/** The RRF directory: the only one holding RXNCONSO.RRF, or the prescribe/ one. */
export function pickRrfDir(files) {
  const dirs = files.filter((f) => basename(f) === "RXNCONSO.RRF").map(dirname);
  if (dirs.length === 1) return dirs[0];
  const prescribe = dirs.filter((d) => /(^|\/)prescribe\/rrf$/.test(d));
  if (prescribe.length === 1) return prescribe[0];
  throw new Error(`expected one prescribable RXNCONSO.RRF, found ${dirs.length}: ${dirs.join(", ")}`);
}

async function main() {
  const root = process.argv[2];
  if (!root) throw new Error("usage: prepare-rxnorm-prescribable.mjs <unzipped-dir> [--update-versions]");
  const files = walk(root);
  const rrfDir = pickRrfDir(files);

  const sabs = new Map();
  for await (const f of rrfRows(join(rrfDir, "RXNCONSO.RRF"))) {
    const sab = f[CONSO.SAB];
    sabs.set(sab, (sabs.get(sab) || 0) + 1);
  }
  const other = foreignSabs(sabs.keys());
  if (other.length > 0) {
    throw new Error(
      `RXNCONSO.RRF carries sources outside the prescribable subset (${other.join(", ")}). ` +
        `Refusing to build from it.`,
    );
  }
  const counts = [...sabs.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`);
  console.error(`RXNCONSO.RRF: ${counts.join(", ")} (only SAB=RXNORM rows are built from)`);

  if (process.argv.includes("--update-versions")) {
    const readmes = files.filter((f) => /readme/i.test(basename(f)));
    const text = readmes.map((f) => readFileSync(f, "utf8").slice(0, 4000)).join("\n");
    const version = releaseDateFrom(text, files.map((f) => basename(f)));
    if (!version) throw new Error("could not read the release date from the readme or file names");
    const vPath = join(SOURCES_DIR, "SOURCE_VERSIONS.json");
    const v = JSON.parse(readFileSync(vPath, "utf8"));
    v["rxnorm-prescribable"] = version;
    writeFileSync(vPath, JSON.stringify(v, null, 2) + "\n");
    console.error(`updated SOURCE_VERSIONS rxnorm-prescribable -> ${version}`);
  }
  process.stdout.write(rrfDir + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
