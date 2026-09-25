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

Eleven relation families, one JSONL file each under `data/`:

| Family | Relation | Example |
| --- | --- | --- |
| `lab-condition` | a lab observation `monitors` / `screens_for` / `diagnoses` a condition | LOINC 2345-7 (Glucose) monitors ICD-10-CM E11 (type 2 diabetes) |
| `condition-synonym` | a lay-language term is a `synonym_of` a coded condition | "high blood pressure" is a synonym of ICD-10-CM I10 |
| `condition-progression` | a condition `may_progress_to` / `risk_factor_for` / `complication_of` another | R73.03 (prediabetes) may progress to E11 |
| `drug-condition` | a drug `may_treat` / `may_prevent` a condition | RxNorm 194279 (palivizumab) may prevent RSV infection |
| `brand-generic` | a brand name is a `tradename_of` a generic ingredient | RxNorm 1000108 (Xeomin) tradename of botulinum toxin type A |
| `ingredient-rollup` | a drug product `has_ingredient` | a clinical drug product to its active ingredient |
| `cvx-disease` | a vaccine (CVX) `prevents` a disease | CVX 03 (MMR) prevents measles |
| `lab-panel` | a LOINC lab panel `has_member` an observation | LOINC 58410-2 (CBC panel) has member 718-7 (Hemoglobin) |
| `lab-group` | a LOINC Group `groups` an observation | LG50009-6 (Cholesterol) groups 2093-3 (Cholesterol) |
| `medication-status-lifecycle` | a FHIR medication status code `has_lifecycle` class | FHIR MedicationStatement `not-taken` has lifecycle `stopped` |
| `medication-status-synonym` | a free-text status is a `synonym_of` / contains a `fragment_of` a FHIR status code | "discontinued" is a synonym of FHIR `stopped` |

## Medication status: one answer to "is this still being taken?"

`medication-status-lifecycle` classifies every FHIR R4 `MedicationRequest.status`
and `MedicationStatement.status` code into one of four lifecycle classes:

| Class | Meaning | Codes |
| --- | --- | --- |
| `active` | the source says it is being taken | active |
| `stopped` | the source says it is not being taken (ended, withdrawn, never taken) | completed, stopped, cancelled, not-taken |
| `unknown` | the source says neither | on-hold, draft, intended, unknown, and an absent status |
| `entered-in-error` | the record is repudiated; drop it, do not read it as stopped | entered-in-error |

Four is the smallest set the consumers need: `unknown` is separate from
`stopped` because an absent or paused status is not evidence that a medication
ended, and `entered-in-error` is separate from both because a repudiated record
is not a statement about the medication at all.

**An absent status is a row, not a rule in code.** Both FHIR status elements are
1..1, so a record without one has a status that is expected but not known: FHIR
data-absent-reason `unknown`, which the table maps to class `unknown`.

`medication-status-synonym` maps non-canonical strings (legacy emitter spellings
such as `discontinued` and `inactive`, and the free text an extraction model
emits) to the FHIR code they mean. A synonym never carries a class of its own;
its class is its target code's row. The matching contract every consumer
implements, in order:

1. Normalize: lower-case, every run of non-alphanumerics to one space, trim. Two
   keys also match when they agree with spaces removed (`not taken` = `nottaken`).
2. Blank or absent: the data-absent-reason `unknown` row.
3. The key equals a FHIR status code: that code's class.
4. The key equals a `synonym_of` subject: its target code's class.
5. The key contains one or more `fragment_of` subjects: the most conservative
   class among them, in the order `entered-in-error`, `stopped`, `unknown`,
   `active` (so "no longer taking" is stopped, not active).
6. Anything else: `unknown`, reported as unmatched.

## The term tables: a second artifact kind

A relation family answers "how do these two codes relate". It cannot answer
"what is this code", because a display name, a status, a class and an example
unit are attributes OF one code rather than relations between two. Forcing them
into a relation shape would make the row redundant (the display already lives
inside the node), multiply the bytes by one row per attribute, and assert
something false about what a node is.

So `terms/` is a second artifact kind alongside `data/`: still one JSON object
per line, still diffable, still CI-validated, with its own schema
(`schema/loinc-term.schema.json`) and its own validator. v0 ships two LOINC term
tables, `terms/loinc-lab.jsonl` and `terms/loinc-clinical.jsonl`. Both are
covered by the schema, allowlist and licence validators, on the same terms as
`data/`.

One real row, copied verbatim from `terms/loinc-lab.jsonl`:

```json
{"term":{"system":"LOINC","code":"2093-3",
         "display":"Cholesterol [Mass/volume] in Serum or Plasma",
         "displayField":"LONG_COMMON_NAME"},
 "loinc":{"LONG_COMMON_NAME":"Cholesterol [Mass/volume] in Serum or Plasma",
          "SHORTNAME":"Cholest SerPl-mCnc","DisplayName":"Cholesterol [Mass/Vol]",
          "CLASS":"CHEM","CLASSTYPE":"1","STATUS":"ACTIVE",
          "EXAMPLE_UCUM_UNITS":"mg/dL","COMMON_TEST_RANK":"61",
          "COMMON_ORDER_RANK":"124","ConsumerName":"Cholesterol, Blood"},
 "cascade":{}}
```

Three things about that shape carry their weight:

- **`loinc` and `cascade` are separate blocks.** Everything under `loinc` is
  byte-equal to the release, so "LOINC values are never edited" is a validator
  rather than a promise. Anything this project authors goes under `cascade`,
  which is empty in v0.
- **`displayField` records which LOINC field the display came from**, because
  the license accepts only certain display names and cares which one travels.
- **Provenance is file-level**, in a sibling `<name>.meta.json` carrying the
  source, the pinned release, the method, the citation, the dates and a content
  hash over the rows. One source and one version are uniform across every row,
  and repeating the block tens of thousands of times would cost megabytes to say
  the same thing. That hash is the integrity reference for `terms/`, the way
  `data/BUILD_MANIFEST.json` is for `data/`.

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
                                  # LOINC needs $LOINC_RELEASE_DIR; read in place, never copied
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
codes. Nothing self-merges.

**LOINC is the exception, and deliberately so.** Its download is gated on a
signed-in human accepting the current license version, so the monthly
regeneration cannot and should not fetch it. `LOINC release watch` runs weekly
and only *notices*: when a newer release exists it opens one issue carrying the
upgrade checklist. LOINC ships roughly twice a year, so that watcher is silent
almost every week. The rebuild itself reads the unpacked release from
`LOINC_RELEASE_DIR`, like every other licensed-adjacent input here. `scripts/review-sweep.mjs` lists curated rows past
their review horizon (candidate quarterly, established annually).

## License

Code is licensed under Apache-2.0 (`LICENSE`); data under `data/` is licensed
under CC-BY-4.0 (`LICENSE-DATA`). Required third-party attribution notices
(LOINC and others) are in `LICENSE-NOTICES.md`.

**`terms/` is not CC-BY-4.0, and neither are the LOINC-derived rows under
`data/`.** A term table is largely verbatim LOINC Table content, and the LOINC
license withholds rights that CC-BY would grant: LOINC field contents may not be
altered (Section 2), a Cascade-authored grouping of LOINC codes is a derivative
the license speaks to directly (Section 1), and Section 12 limits what a
redistributor may promise. So `terms/` and the LOINC-derived rows are
redistributed under `LICENSE-LOINC.txt`, on its terms, and the conditions that
come with them are stated once in `LICENSE-NOTICES.md`.

This repository redistributes LOINC codes and LOINC display names. The full LOINC
Copyright Notice and License is `LICENSE-LOINC.txt`, reachable from this page as
the license requires. The short notice it obliges:

> This material contains content from LOINC (http://loinc.org). LOINC is
> copyright © Regenstrief Institute, Inc. and the Logical Observation Identifiers
> Names and Codes (LOINC) Committee and is available at no cost under the license
> at http://loinc.org/license. LOINC® is a registered United States trademark of
> Regenstrief Institute, Inc.

## Status

v0 payload. See `CONTRIBUTING.md` for the contribution contract. Community
contribution mechanics arrive in a later version.
