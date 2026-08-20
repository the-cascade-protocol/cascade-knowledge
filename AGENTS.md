# AGENTS.md

An open, versioned, provenance-per-row clinical knowledge crosswalk: flat JSONL rows linking codes across systems and connecting lay language to codes. Data, not a terminology and not an ontology.

## Start here

- `CONTRIBUTING.md` -- the row contract, the license wall, determinism, and what must be green. **Read it before writing a single row.**
- `SOURCES.md` -- every source, its license verdict and its canonical URL.
- `README.md` -- what the seven relation families are and what v0 contains.

This repository has no `CLAUDE.md`; `CONTRIBUTING.md` is the contract and this file is the orientation.

## Protocol context

<https://cascadeprotocol.org/llms.txt> is the Cascade Protocol index: install, quick start, data types, MCP server, security model, vocabulary versions, deployment sequence. About 95 lines, meant to be read in full.

Do **not** load `llms-full.txt` from that site. It is roughly 1.3 MB, larger than most working contexts, and as of 2026-08-20 its ontology section is known to be incomplete. Read the TTL files in [`spec`](https://github.com/the-cascade-protocol/spec) instead.

## Ground rules

- **Provenance is required on every row.** No row without a source, a pinned source version, a method, an evidence tier, a resolvable citation, and dates.
- **Walled sources are structurally rejected.** A SNOMED CT, full-UMLS or ATC identifier fails validation and can never be committed. Mappings derived from those belong in `overlay/` as a local build, never in `data/`. Every `source` must be on the allowlist in `sources/allowlist.json`, and every code system must be open.
- **A murky license verdict is a documented stub plus a question, never committed rows.**
- **Dates are constants, never wall-clock.** A build must reproduce the same bytes; use the build date constant, not `new Date()`.
- **Do not hand-edit generated `data/` files.** Change the pipeline or the committed seed and rebuild.
- **New rows land as `candidate`.** Promotion to `established` is maintainer ratification, not something a contribution asserts for itself.
- **Vocabulary is not authored here.** Cascade classes and properties come from `spec`.

## What must be green

```bash
node --test                                                   # unit + integration
node scripts/gen-schemas.mjs && git diff --exit-code schema/  # schemas match generator
node scripts/validate-all.mjs                                 # schema + allowlist wall + determinism
node scripts/validate/validate-code-existence.mjs --sample 12 # codes exist in canonical APIs
```

All four. Node 22. The determinism check is the one most often skipped: a row that does not rebuild byte-for-byte fails CI even when the data itself is right.

## Conventions

- Commits: `feat(data): <family>:`, `feat(validate):`, `fix(ci):`, `docs:`, `chore:`.
- Branch from `main`; open a PR rather than pushing to it.
- State the source, its pinned release, and the evidence tier for every row you add, in the PR body.
