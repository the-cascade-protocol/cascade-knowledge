// Parse the pinned CDC CVX flat file into an authoritative code index.
//
// Format (pipe-delimited, no header):
//   code | short description | full vaccine name | note | status | nonVaccine | lastUpdated
// The code field is right-padded with spaces in the CDC file.

import { readFileSync } from "node:fs";

export function parseCvx(path) {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const index = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < 5) continue;
    const code = parts[0].trim();
    const shortDesc = (parts[1] || "").trim();
    const fullName = (parts[2] || "").trim();
    const status = (parts[4] || "").trim();
    if (!code) continue;
    index.set(code, { display: shortDesc || fullName, fullName, status });
  }
  return index;
}
