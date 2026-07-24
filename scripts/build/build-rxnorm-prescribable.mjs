// Phase 2, pipeline 1: regenerate brand-to-generic and ingredient rollups from
// the RxNorm *prescribable-content* subset ONLY.
//
// HARD WALL: reads only $RXNORM_PRESCRIBE_RRF (the prescribable RXNCONSO.RRF +
// RXNREL.RRF). It must never be pointed at the full UMLS-restricted RxNorm
// release; one read from that poisons redistributability. The prescribable
// release is published by NLM without UMLS Metathesaurus restrictions.
//
// Direction-safety: RxNorm RXNREL direction is famously confusing, so rows are
// classified by the TERM TYPE (TTY) of each end, not by relationship direction.
// For tradename relationships the BN end is the brand and the IN end is the
// generic; for ingredient relationships the IN/PIN/MIN end is the ingredient
// and the SCD/SBD/... end is the product.

import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { writeJsonl } from "../lib/canonical.mjs";
import { provenance } from "../lib/provenance.mjs";
import { DATA_DIR, INPUTS, requireInput } from "../lib/paths.mjs";
import { rrfRows, CONSO, REL } from "../lib/rrf.mjs";

// TTY handling. Lower index = higher priority when choosing a concept's
// representative term type / name.
const STRUCTURAL_PRIORITY = [
  "IN", "PIN", "MIN",
  "BN",
  "SCD", "SBD", "SCDC", "SBDC", "SCDG", "SBDG", "SCDF", "SBDF", "GPCK", "BPCK",
  "SCDFP", "SBDFP", "DF", "DFG",
];
const PRIORITY_INDEX = new Map(STRUCTURAL_PRIORITY.map((t, i) => [t, i]));
const INGREDIENT_TTYS = new Set(["IN", "PIN", "MIN"]);
const PRODUCT_TTYS = new Set([
  "SCD", "SBD", "SCDC", "SBDC", "SCDG", "SBDG", "SCDF", "SBDF", "GPCK", "BPCK",
]);

const TRADENAME_RELA = new Set(["tradename_of", "has_tradename"]);
const INGREDIENT_RELA = new Set(["has_ingredient", "ingredient_of"]);

// Build a per-RXCUI record of {tty, name} from RXNCONSO, keeping the
// highest-priority structural atom (ISPREF, then shortest, then lexicographic
// as deterministic tie-breaks).
async function buildConceptIndex(consoPath) {
  const byRxcui = new Map();
  for await (const f of rrfRows(consoPath)) {
    if (f[CONSO.SAB] !== "RXNORM") continue;
    if (f[CONSO.SUPPRESS] !== "N") continue;
    if (f[CONSO.LAT] !== "ENG") continue;
    const tty = f[CONSO.TTY];
    const prio = PRIORITY_INDEX.get(tty);
    if (prio === undefined) continue; // ignore SY/PSN/TMSY etc. for concept identity
    const rxcui = f[CONSO.RXCUI];
    const str = f[CONSO.STR];
    const ispref = f[CONSO.ISPREF] === "Y";
    const prev = byRxcui.get(rxcui);
    if (!prev) {
      byRxcui.set(rxcui, { tty, prio, name: str, ispref });
      continue;
    }
    const better =
      prio < prev.prio ||
      (prio === prev.prio && ispref && !prev.ispref) ||
      (prio === prev.prio && ispref === prev.ispref && str.length < prev.name.length) ||
      (prio === prev.prio && ispref === prev.ispref && str.length === prev.name.length && str < prev.name);
    if (better) byRxcui.set(rxcui, { tty, prio, name: str, ispref });
  }
  return byRxcui;
}

function categoryOf(info) {
  if (!info) return "other";
  if (INGREDIENT_TTYS.has(info.tty)) return "ingredient";
  if (info.tty === "BN") return "brand";
  if (PRODUCT_TTYS.has(info.tty)) return "product";
  return "other";
}

export async function run() {
  const rrfDir = requireInput(
    INPUTS.rxnormPrescribeRrf,
    "RxNorm prescribable RRF dir ($RXNORM_PRESCRIBE_RRF)",
  );
  const consoPath = join(rrfDir, "RXNCONSO.RRF");
  const relPath = join(rrfDir, "RXNREL.RRF");
  if (!existsSync(consoPath) || !existsSync(relPath)) {
    throw new Error(`expected RXNCONSO.RRF and RXNREL.RRF in ${rrfDir}`);
  }
  mkdirSync(DATA_DIR, { recursive: true });

  const concepts = await buildConceptIndex(consoPath);
  const prov = () =>
    provenance("rxnorm-prescribable", { method: "derived", evidenceTier: "established" });

  const brandGeneric = [];
  const ingredientRollup = [];

  for await (const f of rrfRows(relPath)) {
    if (f[REL.SAB] !== "RXNORM") continue;
    // RXNREL SUPPRESS is usually empty for RxNorm CUI relationships; drop only
    // rows explicitly suppressed (Y) or obsolete (O).
    if (f[REL.SUPPRESS] === "Y" || f[REL.SUPPRESS] === "O") continue;
    const rela = f[REL.RELA];
    const isTradename = TRADENAME_RELA.has(rela);
    const isIngredient = INGREDIENT_RELA.has(rela);
    if (!isTradename && !isIngredient) continue;

    const a = f[REL.RXCUI1];
    const b = f[REL.RXCUI2];
    if (!a || !b || a === b) continue;
    const ia = concepts.get(a);
    const ib = concepts.get(b);
    const ca = categoryOf(ia);
    const cb = categoryOf(ib);

    if (isTradename) {
      // one end brand (BN), one end ingredient (IN)
      let brand, generic;
      if (ca === "brand" && cb === "ingredient") { brand = ia; generic = ib; brand.rxcui = a; generic.rxcui = b; }
      else if (cb === "brand" && ca === "ingredient") { brand = ib; generic = ia; brand.rxcui = b; generic.rxcui = a; }
      else continue;
      brandGeneric.push({
        subject: { system: "RXNORM", code: brand.rxcui, display: brand.name },
        predicate: "tradename_of",
        object: { system: "RXNORM", code: generic.rxcui, display: generic.name },
        provenance: prov(),
      });
    } else {
      // ingredient relationship: one end ingredient, one end product
      let product, ingredient;
      if (ca === "product" && cb === "ingredient") { product = ia; ingredient = ib; product.rxcui = a; ingredient.rxcui = b; }
      else if (cb === "product" && ca === "ingredient") { product = ib; ingredient = ia; product.rxcui = b; ingredient.rxcui = a; }
      else continue;
      ingredientRollup.push({
        subject: { system: "RXNORM", code: product.rxcui, display: product.name },
        predicate: "has_ingredient",
        object: { system: "RXNORM", code: ingredient.rxcui, display: ingredient.name },
        provenance: prov(),
      });
    }
  }

  const bgCount = writeJsonl(join(DATA_DIR, "brand-generic.jsonl"), brandGeneric);
  const irCount = writeJsonl(join(DATA_DIR, "ingredient-rollup.jsonl"), ingredientRollup);
  return { "brand-generic": bgCount, "ingredient-rollup": irCount };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((s) => console.log(JSON.stringify(s, null, 2)));
}
