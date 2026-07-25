# Walled overlay build inputs

Some clinically useful crosswalks are derived from **license-walled** source
terminologies (SNOMED CT, the full UMLS Metathesaurus, ATC). Those rows are
**never committed to this repository**. Instead, this directory documents how a
holder of the relevant license can build the overlay **locally**, on their own
machine, producing a gitignored artifact that their application loads alongside
the open data. This mirrors the "open core, walled overlay" model: honest
degradation without the overlay, full capability with it.

## icd10-snomed (ICD-10-CM <-> SNOMED CT)

SNOMED CT is licensed (free in Affiliate/member territories via the UMLS
Metathesaurus License, but not redistributable here). The open repository
therefore does **not** ship any ICD-10-CM <-> SNOMED CT mapping. A SNOMED CT
licensee can build it from the official **ICD-10-CM to SNOMED CT map** released
by the National Library of Medicine.

### Build

```
node overlay/build-icd10-snomed-overlay.mjs
```

Environment:

- `SNOMED_ICD10_MAP` (required): path to a tab-separated map file with a header
  and at least the columns `referencedComponentId` (SNOMED CT concept id),
  `mapTarget` (ICD-10-CM code), and `referencedComponentName` (SNOMED display).
  The NLM "ICD-10-CM to SNOMED CT" map release and the SNOMED CT International
  `der2_iisssccRefset_ExtendedMapFull` file both provide these columns.
- `KNOWLEDGE_OVERLAY_OUT` (optional): output path. Defaults to
  `overlay/build/icd10-snomed.jsonl` (gitignored).

The output rows use the same canonical row shape as `data/`, but with an object
`system` of `SNOMED-CT`, which is exactly why they belong in the overlay and
would be rejected by the open-allowlist validator if committed. Applications
load `overlay/build/*.jsonl` only when the user/org has the license.

> Note: the Cascade Checkup `icd10_snomed_crosswalk` table (737 rows) is a
> possible input, but it is not shipped here and was not migrated, because those
> rows carry SNOMED CT identifiers. Rebuild the overlay from your own licensed
> SNOMED CT source instead.
