// Phase 2, pipeline 4: lay synonyms from the OAC Consumer Health Vocabulary.
//
// STUB. License verification (2026-07-24) could not confirm a clean, openly
// redistributable copy of the OAC CHV:
//   - The canonical host (George Washington University Biomedical Informatics
//     Center) publishes the flat files but states no redistribution license or
//     data-use grant; the collaboration is described only as "open-access and
//     collaborative", and the files were last updated in 2011.
//   - The reliably available machine copy of CHV lives INSIDE the UMLS
//     Metathesaurus (source abbreviation CHV), which is license-walled.
//
// Per the ratified rule (when in doubt, stub and ask; never commit
// unverifiable rows), this pipeline emits NOTHING in v0. The condition-synonym
// family (migrated from Checkup's curated medical_synonyms) provides the open
// lay-language seed for v0. Re-enabling CHV requires a documented, verifiable
// open license for a specific CHV release. Tracked as a follow-up (see the PR
// body and BACKLOG.md).

export function run() {
  return { "lay-synonyms": 0, _stub: "CHV license unverifiable; no rows emitted (see SOURCES.md)" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(run(), null, 2));
}
