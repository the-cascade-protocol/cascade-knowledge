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
from the same page the materials download from.

Affected family: `data/lab-condition.jsonl` (subject codes are LOINC, and each
subject display is a LOINC Long Common Name).

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
