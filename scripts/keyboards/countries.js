/**
 * Keyboard layouts — which layouts a country uses.
 *
 * Mostly worked out from CLDR's languages per territory: the official
 * languages (and any language most people speak), largest first, each
 * matched to its layout — the country's own variant where there is one
 * ("de-CH", "fr-CA"), else the language's. Pure, so it can be tested.
 *
 * Language alone is wrong in a few well-known places, corrected in OVERRIDE.
 */

/**
 * Countries whose keyboards don't follow their language, first layout =
 * the usual one.
 *
 * @type {Record<string, string[]>}
 */
export const OVERRIDE = {
  // The Dutch layout exists but hardly anyone uses it: US-International is
  // the Dutch keyboard.
  NL: ["en-extended", "nl"],
  // Belgium: one AZERTY for all three languages.
  BE: ["fr-BE"],
  CH: ["de-CH", "fr-CH"],
  LI: ["de-CH"],
  LU: ["lb"],
  CA: ["en", "fr-CA-var", "fr-CA"],
  IE: ["en-GB", "ga"],
  GB: ["en-GB"],
  US: ["en", "en-extended"],
  MT: ["mt", "en-GB"],
  // Poland types on "Polish (Programmers)", a US keyboard with AltGr accents.
  PL: ["pl-extended", "pl"],
  // Latvia's QWERTY variant is the common one; the Windows default is the old
  // ergonomic layout.
  LV: ["lv-qwerty", "lv"],
  GE: ["ka-qwerty", "ka"],
  BR: ["pt-var", "pt"],
  // The Maghreb types French and Arabic on one AZERTY.
  DZ: ["ar-azerty", "fr"],
  MA: ["ar-azerty", "fr", "tzm"],
  TN: ["ar-azerty", "fr"],
  IN: ["en-IN", "hi"],
  NZ: ["en", "mi"],
  KZ: ["kk", "ru"],
  PY: ["es-419", "gn"],
  SN: ["fr", "wo"],
  AD: ["es", "fr"],
  // The Dutch Caribbean types like the Netherlands.
  AW: ["en-extended", "nl"],
  BQ: ["en-extended", "nl"],
  CW: ["en-extended", "nl"],
  SR: ["en-extended", "nl"],
  SX: ["en-extended", "nl"],
  // CJK: the keyboards print the input method's characters.
  CN: ["zh"],
  TW: ["zh-zhuyin", "zh-cangjie"],
  HK: ["zh-cangjie"],
  MO: ["zh-cangjie"],
  JP: ["ja-jis"],
  KR: ["ko-dubeolsik"],
  KP: ["ko-dubeolsik"],
  SG: ["en"],
  // Croatian, Bosnian and Montenegrin Latin share the Slovenian layout.
  HR: ["sl"],
  BA: ["sl", "bs-Cyrl"],
  ME: ["sl", "sr"],
  XK: ["sq", "sr"],
  GL: ["kl", "da"],
};

/** Variants nobody would recognise a country by: Dvorak, IBM tables, duplicates. */
export const NICHE = new Set([
  "en-extended", "en-var", "en-dvorak", "en-dvorakl", "en-dvorakr", "de-extended", "es-extended",
  "it-var", "bg-qwerty-legacy", "th-var", "th-patta-var", "ka-legacy-var",
]); // prettier-ignore

/** Latin American territories (CLDR region 419), for "es-419". */
const LATAM = new Set(
  "AR BO BR BZ CL CO CR CU DO EC GT HN HT MX NI PA PE PR PY SV UY VE".split(" "),
);

/**
 * The locale part of a layout id: "el-Latn-el220" → "el-Latn", "en-extended"
 * → "en", "fr-CA-var" → "fr-CA". Variants are lower-case after the language.
 *
 * @param {string} id
 */
export function localeOf(id) {
  const parts = id.split("-");
  const out = [parts[0]];
  for (const p of parts.slice(1)) {
    if (/^[a-z][a-z0-9]*$/.test(p)) break; // "419" is a region, "el220" a variant
    out.push(p);
  }
  return out.join("-");
}

/**
 * Layouts for one country, the usual one first.
 *
 * @param {string} cc ISO code
 * @param {Record<string, {_populationPercent?: string, _officialStatus?: string}>} languages CLDR's languagePopulation
 * @param {string[]} ids every layout id there is
 * @returns {string[]}
 */
export function layoutsFor(cc, languages, ids) {
  const have = new Set(ids);
  if (OVERRIDE[cc]) return OVERRIDE[cc].filter((id) => have.has(id));
  const usable = ids.filter((id) => !NICHE.has(id));

  /** @type {Map<string, string[]>} locale → ids, plain layout before variants */
  const byLocale = new Map();
  for (const id of [...usable].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    const loc = localeOf(id);
    if (!byLocale.has(loc)) byLocale.set(loc, []);
    /** @type {string[]} */ (byLocale.get(loc)).push(id);
  }

  const all = Object.entries(languages)
    .map(([code, v]) => ({
      lang: code.replace(/_/g, "-"),
      pct: parseFloat(v._populationPercent || "0") || 0,
      status: v._officialStatus || "",
    }))
    .sort((a, b) => b.pct - a.pct);
  // Official languages; failing that, the most spoken one.
  let langs = all.filter(
    (l) =>
      ((l.status === "official" || l.status === "de_facto_official") && l.pct >= 1) ||
      (l.status === "official_regional" && l.pct >= 10),
  );
  if (!langs.length) langs = all.slice(0, 1);

  /** @type {string[]} */
  const out = [];
  for (const { lang } of langs) {
    const base = lang.split("-")[0];
    const tries = [`${lang}-${cc}`, `${base}-${cc}`];
    if (base === "es" && LATAM.has(cc)) tries.push("es-419");
    if (base === "pt" && cc !== "BR") tries.push("pt-PT");
    tries.push(lang);
    // A script-less match only when the language came without one.
    if (lang === base) tries.push(base);
    for (const t of tries) {
      const found = byLocale.get(t);
      if (found) {
        // Variants only for the main language; the others get their usual layout.
        for (const id of out.length ? found.slice(0, 1) : found)
          if (!out.includes(id)) out.push(id);
        break;
      }
    }
  }
  // Without a layout of its own, a country types on the US one.
  if (!out.length && have.has("en")) out.push("en");
  return out.slice(0, 5);
}
