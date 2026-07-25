// Common paths + input resolution.
//
// Large or licensed-adjacent build inputs (the Checkup sqlite, the MED-RT XML,
// the RxNorm prescribable RRF) are NOT committed to this repo. Their locations
// come from environment variables so that no machine-specific path is ever
// baked into committed, public code. When an input's env var is unset or the
// path is missing, the pipeline treats it as absent and skips (used by CI,
// where these inputs are not available). Committed inputs (the pinned CDC CVX
// snapshot) default to an in-repo path.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..");
// DATA_DIR is overridable so the determinism validator can rebuild into a temp
// directory (via a subprocess with $KNOWLEDGE_DATA_DIR set) without touching the
// committed data/ files.
export const DATA_DIR = process.env.KNOWLEDGE_DATA_DIR || join(REPO_ROOT, "data");
export const SCHEMA_DIR = join(REPO_ROOT, "schema");
export const SOURCES_DIR = join(REPO_ROOT, "sources");
export const OVERLAY_DIR = join(REPO_ROOT, "overlay");

// Env-provided input locations (no defaults that point at any personal tree).
export const INPUTS = {
  // sqlite database of Checkup curated crosswalk tables (read-only).
  checkupDb: process.env.CHECKUP_DB || "",
  // MED-RT Core XML release file.
  medrtXml: process.env.MEDRT_XML || "",
  // Directory holding the RxNorm *prescribable* RRF files
  // (RXNCONSO.RRF, RXNREL.RRF). Must be the prescribable subset, never the
  // full UMLS-restricted release.
  rxnormPrescribeRrf: process.env.RXNORM_PRESCRIBE_RRF || "",
  // OAC Consumer Health Vocabulary flat files directory (currently stubbed).
  chvDir: process.env.CHV_DIR || "",
};

// Committed input: pinned CDC CVX snapshot.
export const CDC_CVX_FILE = join(SOURCES_DIR, "cdc-cvx", "CVX.txt");

export class InputMissingError extends Error {
  constructor(what) {
    super(`input not available: ${what}`);
    this.name = "InputMissingError";
    this.inputMissing = true;
  }
}

export function requireInput(path, what) {
  if (!path || !existsSync(path)) throw new InputMissingError(what);
  return path;
}
