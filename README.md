# cascade-knowledge

An open, versioned, provenance-per-row clinical knowledge crosswalk: the mapping
layer that turns isolated codes in a health record into meaning.

Real-world health exports are frequently name-only. A medication that reads
"lisinopril 10 mg tablet" with no code cannot be connected to what it treats,
what labs monitor it, or what it interacts with. This repository publishes flat,
diffable, CI-validated rows that link codes across systems (brand to generic,
lab to condition, drug to condition, vaccine to disease) and connect lay language
to codes, each row carrying its source, evidence tier, and citation.

This is a Cascade Protocol asset. It is data, not a new terminology and not an
ontology. Every committed row is traceable to an openly redistributable source.

Status: v0 payload in progress on branch `feat/v0-payload`.
