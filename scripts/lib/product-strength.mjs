// product-strength: one row per RxNorm clinical drug (SCD) and branded drug
// (SBD), stating its ingredients, their strengths and the dose form.
//
// WHERE EACH FIELD COMES FROM. Structure first, the name only as a cross-check:
//   - components: the SCD `consists_of` its clinical drug components (SCDC,
//     "sertraline 50 MG"); each SCDC `has_ingredient` one ingredient (IN) and
//     may `has_precise_ingredient` one precise ingredient (PIN).
//   - strength: parsed from the SCDC name, which is always "<name> <n> <unit>".
//   - dose form: the SCD `has_dose_form` one dose form (DF).
//   - quantity / release period: the leading "<n> <unit>" tokens of the SCD
//     name ("0.4 ML ...", "24 HR ..."), which RxNorm states only in the name.
// The SCD name must then read back as exactly [prefix] SCDC / SCDC ... DF, using
// the components and form found structurally. A product whose name and
// structure disagree is SKIPPED and counted, never guessed at: a strength list
// a person picks from is worse than useless if one row in it is wrong.
//
// An SBD row copies its clinical drug's components and form (a branded drug is
// by definition its clinical drug under a brand), and is emitted only when the
// SBD maps to exactly one SCD and its own name is that SCD's name plus
// " [<brand>]".
//
// Pure: no IO, no clock. Direction-safety as in the builder: every relation is
// classified by the term types of its two ends, never by RXNREL direction.

const DECIMAL = /^\d+(?:\.\d+)?$/;

// One measure is a decimal and a unit token. RxNorm units never contain a
// space ("MG", "MG/ML", "MG/ACTUAT", "[USP'U]"), which is what makes the
// unit one token.
const COMPONENT_STRENGTH = /^(.*\S) (\d+(?:\.\d+)?) (\S+)$/;

/** The strength an SCDC name states, or null. "sertraline 50 MG" -> 50 MG. */
export function parseComponentStrength(scdcName) {
  const m = COMPONENT_STRENGTH.exec(scdcName);
  if (!m) return null;
  return { value: m[2], unit: m[3] };
}

/**
 * Parse the leading prefix of an SCD name: zero, one or two "<n> <unit>"
 * pairs, where an HR unit is the release period and any other unit is the
 * quantity. Returns null for anything else.
 */
export function parsePrefix(prefix) {
  const out = {};
  if (prefix === "") return out;
  const toks = prefix.split(" ");
  if (toks.length % 2 !== 0 || toks.length > 4) return null;
  for (let i = 0; i < toks.length; i += 2) {
    const value = toks[i];
    const unit = toks[i + 1];
    if (!DECIMAL.test(value) || !unit) return null;
    const key = unit === "HR" ? "releasePeriod" : "quantity";
    if (out[key]) return null;
    out[key] = { value, unit };
  }
  return out;
}

/** True when `needle` sits in `hay` at `at` on word boundaries. */
function boundedAt(hay, needle, at) {
  if (at < 0) return false;
  const before = at === 0 || hay[at - 1] === " ";
  const end = at + needle.length;
  const after = end === hay.length || hay[end] === " ";
  return before && after;
}

/**
 * Split an SCD name against its known component names and dose form name.
 * Returns { order: [componentName...], prefix, formText } or { error }.
 *
 * Components are joined by " / " in the name. The first part may carry the
 * prefix before its component and the last part carries the form after its
 * component. Every component name must be used exactly once.
 */
export function splitProductName(name, componentNames, doseFormName) {
  const parts = name.split(" / ");
  if (parts.length !== componentNames.length) {
    return { error: "component-count" };
  }
  const remaining = new Set(componentNames);
  const order = [];
  let prefix = "";
  let formText = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const first = i === 0;
    const last = i === parts.length - 1;
    // Longest candidate first, so "x 1 MG" never claims the text of "x 10 MG"
    // (boundaries already rule that out; the order makes the choice stable).
    const candidates = [...remaining].sort(
      (a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0),
    );
    let matched = null;
    for (const c of candidates) {
      const at = first ? part.indexOf(c) : 0;
      if (!boundedAt(part, c, at)) continue;
      if (!first && !part.startsWith(c)) continue;
      const before = part.slice(0, at).trim();
      const after = part.slice(at + c.length).trim();
      if (!first && before !== "") continue;
      if (!last && after !== "") continue;
      if (last && after === "") continue;
      matched = c;
      if (first) prefix = before;
      if (last) formText = after;
      break;
    }
    if (!matched) return { error: "name-structure-mismatch" };
    remaining.delete(matched);
    order.push(matched);
  }
  if (doseFormName && formText !== doseFormName) {
    return { error: "dose-form-mismatch" };
  }
  return { order, prefix, formText };
}

function rxnorm(code, display) {
  return { system: "RXNORM", code, display };
}

function single(set) {
  if (!set || set.size !== 1) return null;
  return [...set][0];
}

function addTo(map, key, value) {
  let s = map.get(key);
  if (!s) map.set(key, (s = new Set()));
  s.add(value);
}

const CONSISTS_RELA = new Set(["consists_of", "constitutes"]);
const DOSE_FORM_RELA = new Set(["has_dose_form", "dose_form_of"]);
const INGREDIENT_RELA = new Set(["has_ingredient", "ingredient_of"]);
const PRECISE_RELA = new Set(["has_precise_ingredient", "precise_ingredient_of"]);
const TRADENAME_RELA = new Set(["tradename_of", "has_tradename"]);

/**
 * Collect the relations product-strength needs. Call once per RXNREL row that
 * already passed the builder's SAB and SUPPRESS filters; `ttyOf` returns the
 * representative term type of an RxCUI, or undefined.
 */
export function createRelationIndex() {
  return {
    scdComponents: new Map(), // SCD -> Set<SCDC>
    doseForms: new Map(), // SCD -> Set<DF>
    componentIngredients: new Map(), // SCDC -> Set<IN>
    componentPrecise: new Map(), // SCDC -> Set<PIN>
    sbdClinical: new Map(), // SBD -> Set<SCD>
    sbdBrand: new Map(), // SBD -> Set<BN>
  };
}

export function indexRelation(idx, rela, a, b, ttyOf) {
  const ta = ttyOf(a);
  const tb = ttyOf(b);
  if (!ta || !tb) return;
  // Orient a pair by term type: returns [x, y] where ttyOf(x)===tx, else null.
  const pick = (tx, ty) =>
    ta === tx && tb === ty ? [a, b] : tb === tx && ta === ty ? [b, a] : null;
  let p;
  if (CONSISTS_RELA.has(rela) && (p = pick("SCD", "SCDC"))) {
    addTo(idx.scdComponents, p[0], p[1]);
  } else if (DOSE_FORM_RELA.has(rela) && (p = pick("SCD", "DF"))) {
    addTo(idx.doseForms, p[0], p[1]);
  } else if (INGREDIENT_RELA.has(rela) && (p = pick("SCDC", "IN"))) {
    addTo(idx.componentIngredients, p[0], p[1]);
  } else if (PRECISE_RELA.has(rela) && (p = pick("SCDC", "PIN"))) {
    addTo(idx.componentPrecise, p[0], p[1]);
  } else if (TRADENAME_RELA.has(rela) && (p = pick("SBD", "SCD"))) {
    addTo(idx.sbdClinical, p[0], p[1]);
  } else if (INGREDIENT_RELA.has(rela) && (p = pick("SBD", "BN"))) {
    addTo(idx.sbdBrand, p[0], p[1]);
  }
}

/**
 * Build every product-strength row. `concepts` maps RxCUI -> { tty, name };
 * `prov` returns a fresh provenance block. Returns { rows, skipped } where
 * skipped counts each reason a product was left out (reported, deterministic).
 */
export function productStrengthRows(concepts, idx, prov) {
  const rows = [];
  const skipped = {};
  const skip = (why) => {
    skipped[why] = (skipped[why] || 0) + 1;
  };
  const nameOf = (rxcui) => concepts.get(rxcui)?.name;
  const byCode = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);
  const scdRows = new Map();

  const scds = [...concepts.entries()]
    .filter(([, c]) => c.tty === "SCD")
    .map(([code]) => code)
    .sort(byCode);

  for (const scd of scds) {
    const name = nameOf(scd);
    const components = [...(idx.scdComponents.get(scd) || [])].sort(byCode);
    if (components.length === 0) { skip("scd-no-components"); continue; }
    const df = single(idx.doseForms.get(scd));
    if ((idx.doseForms.get(scd)?.size || 0) > 1) { skip("scd-several-dose-forms"); continue; }
    const byName = new Map();
    let dup = false;
    for (const c of components) {
      const n = nameOf(c);
      if (byName.has(n)) dup = true;
      byName.set(n, c);
    }
    if (dup) { skip("scd-duplicate-component-name"); continue; }
    const split = splitProductName(name, [...byName.keys()], df ? nameOf(df) : undefined);
    if (split.error) { skip(`scd-${split.error}`); continue; }
    const prefix = parsePrefix(split.prefix);
    if (!prefix) { skip("scd-unparsed-prefix"); continue; }

    const out = [];
    let bad = null;
    for (const componentName of split.order) {
      const scdc = byName.get(componentName);
      const strength = parseComponentStrength(componentName);
      if (!strength) { bad = "component-unparsed-strength"; break; }
      const ing = single(idx.componentIngredients.get(scdc));
      if (!ing) { bad = "component-not-one-ingredient"; break; }
      const preciseSet = idx.componentPrecise.get(scdc);
      if (preciseSet && preciseSet.size > 1) { bad = "component-several-precise"; break; }
      const pin = single(preciseSet);
      out.push({
        component: rxnorm(scdc, componentName),
        ingredient: rxnorm(ing, nameOf(ing)),
        ...(pin ? { preciseIngredient: rxnorm(pin, nameOf(pin)) } : {}),
        strength,
      });
    }
    if (bad) { skip(bad); continue; }

    const row = {
      product: { ...rxnorm(scd, name), tty: "SCD" },
      components: out,
      doseForm: df
        ? rxnorm(df, nameOf(df))
        : { system: "RXNORM", display: split.formText },
      ...(prefix.quantity ? { quantity: prefix.quantity } : {}),
      ...(prefix.releasePeriod ? { releasePeriod: prefix.releasePeriod } : {}),
      provenance: prov(),
    };
    scdRows.set(scd, row);
    rows.push(row);
  }

  const sbds = [...concepts.entries()]
    .filter(([, c]) => c.tty === "SBD")
    .map(([code]) => code)
    .sort(byCode);
  for (const sbd of sbds) {
    const scd = single(idx.sbdClinical.get(sbd));
    if (!scd) { skip("sbd-not-one-clinical-drug"); continue; }
    const base = scdRows.get(scd);
    if (!base) { skip("sbd-clinical-drug-skipped"); continue; }
    const name = nameOf(sbd);
    const m = /^(.*) \[([^\]]+)\]$/.exec(name);
    if (!m || m[1] !== base.product.display) { skip("sbd-name-mismatch"); continue; }
    const bn = single(idx.sbdBrand.get(sbd));
    rows.push({
      product: { ...rxnorm(sbd, name), tty: "SBD" },
      clinicalDrug: rxnorm(scd, base.product.display),
      ...(bn ? { brand: rxnorm(bn, nameOf(bn)) } : {}),
      components: base.components,
      doseForm: base.doseForm,
      ...(base.quantity ? { quantity: base.quantity } : {}),
      ...(base.releasePeriod ? { releasePeriod: base.releasePeriod } : {}),
      provenance: prov(),
    });
  }
  return { rows, skipped };
}

// --- Canonical serialization ------------------------------------------------
// Fixed key order at every level, absent optionals omitted (never null), rows
// sorted by their canonical line. Same rules as the relation families.

const PROV_KEYS = [
  "source",
  "sourceVersion",
  "method",
  "evidenceTier",
  "citation",
  "addedDate",
  "reviewedDate",
];

function node(n) {
  const out = { system: n.system };
  if (n.code !== undefined && n.code !== null && n.code !== "") out.code = String(n.code);
  out.display = n.display;
  return out;
}

function measure(m) {
  return { value: m.value, unit: m.unit };
}

export function serializeProductStrengthRow(row) {
  const o = {
    product: { ...node(row.product), tty: row.product.tty },
  };
  if (row.clinicalDrug) o.clinicalDrug = node(row.clinicalDrug);
  if (row.brand) o.brand = node(row.brand);
  o.components = row.components.map((c) => {
    const x = { component: node(c.component), ingredient: node(c.ingredient) };
    if (c.preciseIngredient) x.preciseIngredient = node(c.preciseIngredient);
    x.strength = measure(c.strength);
    return x;
  });
  o.doseForm = node(row.doseForm);
  if (row.quantity) o.quantity = measure(row.quantity);
  if (row.releasePeriod) o.releasePeriod = measure(row.releasePeriod);
  const p = {};
  for (const k of PROV_KEYS) p[k] = row.provenance[k];
  o.provenance = p;
  return JSON.stringify(o);
}

export function serializeProductStrengthJsonl(rows) {
  const lines = Array.from(new Set(rows.map(serializeProductStrengthRow)));
  lines.sort();
  return lines.length ? lines.join("\n") + "\n" : "";
}
