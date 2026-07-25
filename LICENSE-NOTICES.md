# Third-party attribution notices

The data in this repository references codes from external terminologies. The
notices below are required by, or acknowledge, those sources. They apply in
addition to `LICENSE-DATA`.

## LOINC (Regenstrief Institute)

This product includes LOINC codes and Long Common Names. LOINC content is used
under the LOINC license and must carry the following acknowledgment:

> This material contains content from LOINC (https://loinc.org). LOINC is
> copyright 1995-2026, Regenstrief Institute, Inc. and the Logical Observation
> Identifiers Names and Codes (LOINC) Committee and is available at no cost under
> the license at https://loinc.org/license/. LOINC is a registered United States
> trademark of Regenstrief Institute, Inc.

Affected family: `data/lab-condition.jsonl` (subject codes are LOINC).

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
