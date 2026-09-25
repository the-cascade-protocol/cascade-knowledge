# Third-party attribution notices

The data in this repository references codes from external terminologies. The
notices below are required by, or acknowledge, those sources. They apply in
addition to `LICENSE-DATA`.

## LOINC (Regenstrief Institute)

This product includes LOINC codes and LOINC display names. The LOINC license
(Section 10) requires the following notice verbatim, and it is reproduced here
without alteration:

> This material contains content from LOINC (http://loinc.org). LOINC is
> copyright © Regenstrief Institute, Inc. and the Logical Observation Identifiers
> Names and Codes (LOINC) Committee and is available at no cost under the license
> at http://loinc.org/license. LOINC® is a registered United States trademark of
> Regenstrief Institute, Inc.

The full LOINC Copyright Notice and License is vendored in this repository as
`LICENSE-LOINC.txt`, because the license requires each copy of the Licensed
Materials to include it and, for Internet distribution, to make it accessible
from the same page the materials download from. That file is a byte-identical
copy of `LoincLicense_5.8.txt` as shipped in the LOINC 2.83 release, so it is
the licensor's own text rather than a transcription: **License version 5.8**,
the version registered users were asked to accept on 2026-09-15.

Affected artifacts:

- `terms/loinc-lab.jsonl` and `terms/loinc-clinical.jsonl`, the LOINC term
  tables. Each row carries a LOINC code, a licensed display name, the field that
  display came from, and a block of LOINC values that are byte-equal to the
  release.
- `data/lab-panel.jsonl` (LOINC panel membership) and `data/lab-group.jsonl`
  (LOINC Group membership; the subject is a Group identifier in the
  `LOINC-GROUP` system, carrying its Group Name as the license requires for an
  identifier that is not a LOINC code).
- `data/lab-condition.jsonl` (subject codes are LOINC, and each subject display
  is a LOINC Long Common Name).

These are built from the LOINC **2.83** release, pinned as `loinc` in
`sources/SOURCE_VERSIONS.json`.

Three obligations this repository must keep as LOINC content grows here:

- **Identifier and display travel together.** Section 10(c) requires every
  extracted LOINC value to carry its LOINC identifier and one of the LOINC
  display names. The canonical row shape satisfies this by construction; a row
  with a LOINC code and no display is a license defect, not only a data defect.
- **LOINC values are never edited.** Section 2 forbids changing LOINC field
  contents. Cascade labels, lay synonyms and groupings belong in added fields
  alongside the LOINC value, never in place of it.
- **Third-party content inside LOINC carries its own notice.** Where a LOINC term
  has an `EXTERNAL_COPYRIGHT_NOTICE` (survey instruments and their answers, for
  example), that notice must ship with the row or the content must be deleted.
  Inclusion in LOINC is not permission to administer such an instrument.

Section 10(b) offers those two options, and this repository takes **both**,
notice by notice rather than by category. Every distinct
`EXTERNAL_COPYRIGHT_NOTICE` in the slice has an explicit, reasoned verdict in
`sources/loinc-notice-verdicts.json`:

**Only content that is explicitly disallowed is withheld.** A notice is
`restricted` only when its text requires a licence, requires written permission,
or limits the purpose of use. Everything else is `permissive`.

- **`permissive`: kept, with the notice attached.** 41 of the 47 notices in
  2.83, covering 593 rows (8 laboratory and 585 clinical). Two kinds sit here
  that might look restrictive and are not. A bare reservation of rights ("All
  rights reserved") with no stated condition on use is not an explicit
  prohibition. And a condition that shipping the notice verbatim already
  satisfies (keep the attribution, do not alter the instrument) does not
  restrict, because Section 2 already forbids editing LOINC values.
- **`restricted`: deleted.** 6 notices covering 74 clinical rows, each of which
  explicitly disallows the use: Praktikon B.V. (49 rows, reproduction only with
  written permission), National POLST (9, non-commercial personal use only), the
  University of Michigan for FLACC and rFLACC (7, users must obtain a licence),
  the AAAM Abbreviated Injury Scale (4, requires a licence), HD Nursing's Hester
  Davis Scale (3, requires a licence), and MedChi's Barthel Index (2, permission
  required to modify or to use commercially). Complying with those means
  accepting each owner's terms, which is not something a build pipeline can do
  on a reader's behalf.

That file is **fail-closed**: the builder and the licence validator both refuse
any notice text not listed in it verbatim, naming the notice and the codes
carrying it. A new or reworded notice in the next LOINC release stops the build
and gets a human verdict rather than defaulting into either bucket.

**A relation row cannot carry a notice.** The family schemas are
`additionalProperties: false`, so `data/lab-panel.jsonl` has nowhere to put one.
154 of its rows reference 8 laboratory codes whose term rows do carry a notice:
`85349-9`, `85624-5`, `85625-2`, `85626-0`, `85904-1`, `85905-8`, `88863-6` and
`89041-8`. For those, **the notice travels with the term table**
(`terms/loinc-lab.jsonl`), not with the relation file, and a consumer of the
relation family alone does not receive it. `scripts/validate/validate-loinc-license.mjs`
prints that list on every run so it cannot grow unnoticed.

## ICD-10-CM

ICD-10-CM is maintained by the U.S. National Center for Health Statistics (CDC)
and the Centers for Medicare and Medicaid Services and is in the U.S. public
domain. Reference: https://www.cms.gov/medicare/coding-billing/icd-10-codes

Affected families: `condition-synonym`, `condition-progression`, `cvx-disease`,
and the condition side of `lab-condition`.

## MED-RT (Medication Reference Terminology)

MED-RT is produced by the U.S. Department of Veterans Affairs and the National
Library of Medicine and is a U.S. Government work in the public domain.
Reference: https://www.nlm.nih.gov/research/umls/sourcereleasedocs/current/MED-RT/index.html

Affected family: `data/drug-condition.jsonl`.

## MeSH (Medical Subject Headings)

MeSH is produced by the U.S. National Library of Medicine and is in the U.S.
public domain. Reference: https://www.nlm.nih.gov/mesh/

Affected family: the disease side of `data/drug-condition.jsonl` (MeSH codes as
provided by MED-RT).

## RxNorm (Current Prescribable Content subset)

RxNorm is produced by the U.S. National Library of Medicine. The Current
Prescribable Content subset is released without UMLS Metathesaurus restrictions.
Reference: https://www.nlm.nih.gov/research/umls/rxnorm/docs/prescribe.html

Affected families: `data/brand-generic.jsonl`, `data/ingredient-rollup.jsonl`,
and the drug side of `data/drug-condition.jsonl`.

## CDC CVX

The CVX vaccine code set is produced by the CDC Immunization Information Systems
and is a U.S. Government work in the public domain. Reference:
https://www2.cdc.gov/vaccines/iis/iisstandards/vaccines.asp?rpt=cvx

Affected family: `data/cvx-disease.jsonl`.

## HL7 FHIR R4

The `medication-status-lifecycle` and `medication-status-synonym` families carry
codes and display names from three FHIR R4 (4.0.1) code systems:
`http://hl7.org/fhir/CodeSystem/medicationrequest-status`,
`http://hl7.org/fhir/CodeSystem/medication-statement-status` and
`http://terminology.hl7.org/CodeSystem/data-absent-reason`. FHIR is published by
HL7 International under Creative Commons "No Rights Reserved" (CC0), so no notice
is required; this acknowledgement is given anyway. FHIR® is a registered
trademark of Health Level Seven International.
https://hl7.org/fhir/R4/license.html
