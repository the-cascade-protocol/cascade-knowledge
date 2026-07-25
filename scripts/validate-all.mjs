// Core validation gate (deterministic, no network): schema conformance,
// open-source allowlist proof (the UMLS/SNOMED wall), and determinism +
// integrity. The networked code-existence check runs as its own step
// (scripts/validate/validate-code-existence.mjs) so this gate stays reliable.

import { validateSchema } from "./validate/validate-schema.mjs";
import { validateAllowlist } from "./validate/validate-allowlist.mjs";
import { validateDeterminism } from "./validate/validate-determinism.mjs";

function report(label, r, summary) {
  const status = r.ok ? "PASS" : "FAIL";
  console.log(`[${status}] ${label}: ${summary}`);
  if (!r.ok) for (const e of r.errors.slice(0, 40)) console.log("    " + e);
}

const schema = validateSchema();
report("schema", schema, `${schema.checked} rows checked`);

const allow = validateAllowlist();
report("allowlist", allow, `${allow.checked} rows checked`);

const det = validateDeterminism();
report(
  "determinism",
  det,
  `${det.checksums} checksums, ${det.inProcessRebuilt} in-process rebuilds, full [${det.fullRebuilt.join(", ")}]`,
);
for (const n of det.notes) console.log("    note: " + n);

const ok = schema.ok && allow.ok && det.ok;
console.log(ok ? "\nALL CORE VALIDATORS PASSED" : "\nVALIDATION FAILED");
process.exit(ok ? 0 : 1);
