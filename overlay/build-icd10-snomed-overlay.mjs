// Walled overlay builder: ICD-10-CM <-> SNOMED CT.
//
// Runs LOCALLY for a SNOMED CT licensee. Reads a licensed SNOMED CT map file
// ($SNOMED_ICD10_MAP) and writes a GITIGNORED overlay artifact. Nothing this
// script produces is ever committed: its rows carry SNOMED-CT identifiers and
// would be rejected by the open-allowlist validator. See overlay/README.md.

import { createReadStream, mkdirSync, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.KNOWLEDGE_OVERLAY_OUT || join(HERE, "build", "icd10-snomed.jsonl");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const mapFile = process.env.SNOMED_ICD10_MAP;
if (!mapFile) {
  fail(
    "SNOMED_ICD10_MAP is required (path to a licensed ICD-10-CM <-> SNOMED CT map TSV). " +
      "This overlay is built locally by a SNOMED CT licensee and is never committed. See overlay/README.md.",
  );
}

const rl = createInterface({ input: createReadStream(mapFile, { encoding: "utf8" }), crlfDelay: Infinity });
mkdirSync(dirname(OUT), { recursive: true });
const out = createWriteStream(OUT);

let header = null;
let col = {};
let written = 0;
const lines = [];

rl.on("line", (line) => {
  if (header === null) {
    header = line.split("\t");
    col = {
      snomed: header.indexOf("referencedComponentId"),
      icd10: header.indexOf("mapTarget"),
      name: header.indexOf("referencedComponentName"),
    };
    if (col.snomed < 0 || col.icd10 < 0) {
      fail("map file must have columns referencedComponentId and mapTarget");
    }
    return;
  }
  const f = line.split("\t");
  const snomed = f[col.snomed];
  const icd10 = f[col.icd10];
  if (!snomed || !icd10) return;
  const name = col.name >= 0 ? f[col.name] || snomed : snomed;
  lines.push(
    JSON.stringify({
      subject: { system: "ICD-10-CM", code: icd10, display: name },
      predicate: "maps_to",
      object: { system: "SNOMED-CT", code: snomed, display: name },
      provenance: {
        source: "snomed-overlay-local",
        sourceVersion: "local",
        method: "derived",
        evidenceTier: "established",
        citation: "https://www.nlm.nih.gov/healthit/snomedct/index.html",
        addedDate: "local",
        reviewedDate: "local",
      },
    }),
  );
});

rl.on("close", () => {
  lines.sort();
  out.write(lines.length ? lines.join("\n") + "\n" : "");
  out.end();
  written = lines.length;
  console.log(`wrote ${written} overlay rows to ${OUT} (gitignored, not for commit)`);
});
