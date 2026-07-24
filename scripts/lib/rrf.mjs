// Streaming reader for RxNorm RRF (pipe-delimited) files. Yields one array of
// fields per line. RRF lines carry a trailing pipe, producing a trailing empty
// field, which callers simply index past.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export async function* rrfRows(path) {
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    yield line.split("|");
  }
}

// RXNCONSO.RRF column indices.
export const CONSO = {
  RXCUI: 0,
  LAT: 1,
  TS: 2,
  ISPREF: 6,
  SAB: 11,
  TTY: 12,
  CODE: 13,
  STR: 14,
  SUPPRESS: 16,
};

// RXNREL.RRF column indices.
export const REL = {
  RXCUI1: 0,
  REL: 3,
  RXCUI2: 4,
  RELA: 7,
  SAB: 10,
  SUPPRESS: 14,
};
