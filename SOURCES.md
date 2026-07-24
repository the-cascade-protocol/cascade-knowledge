# Sources and license verdicts

Every source below was license-verified **before** its rows were ingested. The
machine-readable allowlist is `sources/allowlist.json`; this file is its
human-readable companion. Pinned release versions are in
`sources/SOURCE_VERSIONS.json`. Required attribution notices are in
`LICENSE-NOTICES.md`.

## Committed open sources

| Source id | Release | License verdict | Canonical citation |
| --- | --- | --- | --- |
| `checkup-curation` | 2026-02 | Open. This project's own curation over open code systems (LOINC, ICD-10-CM, CVX). Redistributable as CC-BY-4.0. | https://loinc.org/ and https://www.cms.gov/medicare/coding-billing/icd-10-codes |
| `med-rt` | 2026.01.05 | Public domain (US Government work). | https://www.nlm.nih.gov/research/umls/sourcereleasedocs/current/MED-RT/index.html |
| `rxnorm-prescribable` | 2026-01-05 | Redistributable. The RxNorm **Current Prescribable Content** subset is released by NLM without UMLS Metathesaurus restrictions. Verified against the release readme (title "RxNorm 01/05/2026 Current Prescribable Content"; file set `prescribe/rrf/{RXNCONSO,RXNREL,RXNSAT}.RRF`). | https://www.nlm.nih.gov/research/umls/rxnorm/docs/prescribe.html |
| `cdc-cvx` | retrieved 2026-07-24 (289 codes) | Public domain (US Government work, CDC IIS). | https://www2.cdc.gov/vaccines/iis/iisstandards/vaccines.asp?rpt=cvx |

Code systems appearing in committed rows: `LOINC`, `ICD-10-CM`, `RXNORM`,
`MESH`, `MED-RT`, `CVX`, and `text` (free-text lay subjects). All open.

### LOINC attribution

LOINC content is redistributable in both commercial and non-commercial use under
the LOINC license, provided the license and copyright are acknowledged. The
required notice is reproduced in `LICENSE-NOTICES.md`. Citation:
https://loinc.org/license/

## Phase 1 license triage (Cascade Checkup `clinical_knowledge.sqlite`)

The Checkup curated tables were triaged per table before migration. The sqlite
itself carries a `umls_disclaimer` on its RxNorm-derived drug tables ("Contains
data from RxNorm (UMLS license). Do not redistribute raw data."), which is why
those tables are never migrated.

| Table (rows) | Codes | Verdict | Destination |
| --- | --- | --- | --- |
| `loinc_condition_map` (251) | LOINC, ICD-10-CM | Open | `data/lab-condition.jsonl` |
| `medical_synonyms` (254) | text, ICD-10-CM | Open | `data/condition-synonym.jsonl` |
| `condition_progressions` (126) | ICD-10-CM | Open | `data/condition-progression.jsonl` |
| `cvx_disease_map` (80) | CVX, ICD-10-CM | Open (CVX validated against the CDC snapshot) | `data/cvx-disease.jsonl` |
| `icd10_snomed_crosswalk` (737) | **SNOMED CT** | **Walled** | `overlay/` docs only; never committed |
| `drug_class_allergens` (64) | **SNOMED CT** | **Walled** / out of v0 scope | not migrated |
| `drugs`, `brand_names`, `drug_conditions`, `brand_generic_map`, `product_ingredient_map`, `pricing`, `nadac_raw`, `rxcui_ndc_map`, `drug_external_ids` | RxNorm (UMLS-derived) | **Walled** | not migrated; Phase 2 regenerates equivalent content from the prescribable subset |
| `loinc_map` (51), `condition_map` (20) | LOINC / ICD-10-CM name normalization | **Deferred**: the provenance of the display/normalized strings is not established. Not migrated in v0. | follow-up (see BACKLOG) |

The seed extracts of the four open tables are committed under
`sources/checkup-curation/` so the migration rebuilds deterministically without
the app database.

## Regenerated bulk (Phase 2)

- **RxNorm prescribable** -> `brand-generic` (6,220) and `ingredient-rollup`
  (28,309). Built only from the `prescribe/rrf/` subset. The sibling full
  `rrf/` release is UMLS-restricted and is never read.
- **MED-RT** -> `drug-condition` (18,111: 15,360 `may_treat` + 2,751
  `may_prevent`). Parsed fresh from the Core XML. Associations whose drug or
  disease side is SNOMED CT are dropped structurally.
- **CDC CVX** -> validates and names the `cvx-disease` rows. CDC does not publish
  a CVX-to-disease linkage, so the linkage itself is our curated crosswalk
  (`checkup-curation`), with every CVX code confirmed present in the CDC snapshot.

## Stubbed source

| Source | Status | Reason |
| --- | --- | --- |
| OAC Consumer Health Vocabulary (CHV) | **Stub, no rows** | License could not be verified as redistributable (2026-07-24). The canonical host (George Washington University Biomedical Informatics Center) states no redistribution grant and the files were last updated 2011; the reliably available machine copy is inside the license-walled UMLS Metathesaurus. Re-enabling CHV requires a documented open license for a specific release. Citation: https://biomedinfo.smhs.gwu.edu/chv-files |

The `condition-synonym` family (migrated from Checkup's `medical_synonyms`)
provides the open lay-language seed for v0 in place of CHV.

## Walled overlay (never committed)

SNOMED CT, the full UMLS Metathesaurus, and ATC are license-walled. See
`overlay/README.md` for how a licensee builds the ICD-10-CM <-> SNOMED CT overlay
locally.
