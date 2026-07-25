# cascade-knowledge

An open, versioned, provenance-per-row clinical knowledge crosswalk: the mapping
layer that turns isolated codes in a health record into meaning.

Real-world health exports are frequently name-only. A medication that reads
"lisinopril 10 mg tablet" with no code cannot be connected to what it treats,
what labs monitor it, or what it interacts with. A lab result with a LOINC code
is useful only if something knows which conditions that lab monitors. This
repository publishes flat, diffable, CI-validated rows that link codes across
systems and connect lay language to codes, each row carrying its source,
evidence tier, and citation.

This is a Cascade Protocol asset. It is data, not a new terminology and not an
ontology. Every committed row is traceable to an openly redistributable source.

## What is in v0

Seven relation families, one JSONL file each under `data/`:

| Family | Relation | Example |
| --- | --- | --- |
| `lab-condition` | a lab observation `monitors` / `screens_for` / `diagnoses` a condition | LOINC 2345-7 (Glucose) monitors ICD-10-CM E11 (type 2 diabetes) |
| `condition-synonym` | a lay-language term is a `synonym_of` a coded condition | "high blood pressure" is a synonym of ICD-10-CM I10 |
| `condition-progression` | a condition `may_progress_to` / `risk_factor_for` / `complication_of` another | R73.03 (prediabetes) may progress to E11 |
| `drug-condition` | a drug `may_treat` / `may_prevent` a condition | RxNorm 194279 (palivizumab) may prevent RSV infection |
| `brand-generic` | a brand name is a `tradename_of` a generic ingredient | RxNorm 1000108 (Xeomin) tradename of botulinum toxin type A |
| `ingredient-rollup` | a drug product `has_ingredient` | a clinical drug product to its active ingredient |
| `cvx-disease` | a vaccine (CVX) `prevents` a disease | CVX 03 (MMR) prevents measles |

## The row shape

Every row is one line of JSON with the same canonical shape and a full
provenance block:

```json
{
  "subject": { "system": "LOINC", "code": "2345-7", "display": "Glucose ..." },
  "predicate": "monitors",
  "object": { "system": "ICD-10-CM", "code": "E11", "display": "Type 2 diabetes ..." },
  "provenance": {
    "source": "checkup-curation",
    "sourceVersion": "2026-02",
    "method": "curated",
    "evidenceTier": "established",
    "citation": "https://loinc.org/",
    "addedDate": "2026-07-24",
    "reviewedDate": "2026-07-24"
  }
}
```

The JSON Schema for each family lives in `schema/`. `method` is `curated` or
`derived`; `evidenceTier` is `candidate` or `established`. Free-text subjects
(lay synonyms) use the pseudo-system `text` and carry no code.

## Open core, walled overlay

The open core in this repository is built only from openly redistributable
sources: MED-RT, the RxNorm Current Prescribable Content subset, CDC CVX, LOINC
(redistributable with attribution), ICD-10-CM (US public domain), and this
project's own curation. Sources whose license would wall the data (SNOMED CT,
the full UMLS Metathesaurus, ATC) are **never** committed. Where such a mapping
is valuable, `overlay/` documents how a licensee builds it locally into a
gitignored artifact their application loads on top of the open core.

This boundary is enforced structurally, not by policy: a validator proves every
committed row cites an allowlisted open source and uses only open code systems,
so a walled code (for example a SNOMED CT identifier) cannot be committed even
by accident. See `sources/allowlist.json` and `SOURCES.md`.

## Determinism

Builds are byte-deterministic: rows carry fixed date constants and pinned source
release versions (`sources/SOURCE_VERSIONS.json`), are serialized with a fixed
key order, and are sorted before writing. Rebuilding from the same inputs
reproduces the committed bytes exactly, and CI checks it.

## Build and validate

No runtime dependencies. Node 20+.

```bash
node scripts/build-all.mjs        # run every pipeline (skips inputs it cannot find)
node scripts/validate-all.mjs     # schema + open-allowlist wall + determinism/integrity
node scripts/validate/validate-code-existence.mjs --sample 12   # canonical-API check
node --test                        # unit + integration tests
```

The licensed-adjacent inputs (the Checkup sqlite, the MED-RT XML, the RxNorm
prescribable RRF) are not stored in this repository; the build scripts read them
from environment-provided paths and skip cleanly when they are absent. The CVX
snapshot and the curated seeds are committed, so those pipelines rebuild anywhere.

## Freshness

`sources/SOURCE_VERSIONS.json` pins each source release. Two scheduled workflows
keep the data current: a monthly regeneration that re-pulls open releases and
opens a PR with the diff, and a monthly code-liveness audit that revalidates
every committed code against the canonical APIs and flags retired or remapped
codes. Nothing self-merges. `scripts/review-sweep.mjs` lists curated rows past
their review horizon (candidate quarterly, established annually).

## License

Code is licensed under Apache-2.0 (`LICENSE`); data under `data/` is licensed
under CC-BY-4.0 (`LICENSE-DATA`). Required third-party attribution notices
(LOINC and others) are in `LICENSE-NOTICES.md`.

## Status

v0 payload. See `CONTRIBUTING.md` for the contribution contract. Community
contribution mechanics arrive in a later version.
