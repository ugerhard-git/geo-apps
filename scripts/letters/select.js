/**
 * Letter frequencies — turning FineFreq's character counts into letter
 * shares, and choosing each country's languages.
 *
 * Pure (no files, no network), so the rules can be unit-tested. The runner is
 * build-data.mjs. Nothing here counts text: FineFreq publishes how often each
 * character occurs in each language's part of FineWeb / FineWeb2 (Common
 * Crawl, 2013–2025); this only keeps the letters, folds case and turns the
 * counts into shares.
 */

/** Letters rarer than this (in %) are left out of the data: almost all are stray foreign words. */
export const MIN_PERCENT = 0.005;

/** At most this many letters per language. */
export const MAX_LETTERS = 90;

/** Languages that capitalise i as İ and ı as I. */
const DOTTED_I = new Set(["tr", "az", "crh", "tt", "kaa"]);

const LATIN = /^\p{Script=Latin}$/u;
/** Modifier letters that are letters of some Latin alphabets: ʻ (Samoan, Hawaiian, Tongan), ʼ, ꞌ. */
const MODIFIER = /^[ʹ-ʿˈˊˋꞌ]$/u;
/** Combining marks, for tone and vowel marks that have no precomposed letter (Yoruba ẹ́). */
const MARK = /^\p{Mn}$/u;

/**
 * Whether a character belongs in a Latin alphabet's letter chart.
 *
 * @param {string} ch one code point
 * @param {string} category Unicode general category, e.g. "Ll"
 */
export function isLetter(ch, category) {
  if ([...ch].length !== 1) return false;
  if (category.startsWith("L") && (LATIN.test(ch) || MODIFIER.test(ch))) return true;
  return category === "Mn" && MARK.test(ch) && ch.codePointAt(0) < 0x0370;
}

/**
 * A FineFreq CSV row as a record. FineFreq's CSVs quote fields containing
 * commas or quotes, the way RFC 4180 does.
 *
 * @param {string} text the whole CSV
 * @returns {Array<Record<string, string>>}
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body
    .filter((r) => r.length === head.length)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/**
 * Letter shares for one language.
 *
 * @param {Array<Record<string, string>>} rows FineFreq rows: character, unicode_category, total_frequency_all_time
 * @param {string} lang CLDR language code, for case folding (Turkish ı/İ)
 * @returns {{letters: Array<[string, number]>, total: number}} letter and share in %, most common first; letters counted
 */
export function letterShares(rows, lang) {
  const locale = DOTTED_I.has(lang) ? "tr" : "en";
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const r of rows) {
    const ch = r.character || "";
    const n = Number(r.total_frequency_all_time);
    if (!Number.isFinite(n) || n <= 0 || !isLetter(ch, r.unicode_category || "")) continue;
    // Folding can make two characters (ß → ß, ẞ → ß; İ → i in Turkish).
    const low = ch.toLocaleLowerCase(locale).normalize("NFC");
    if ([...low].length !== 1) continue;
    counts.set(low, (counts.get(low) || 0) + n);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return { letters: [], total: 0 };
  const letters = [...counts]
    .map(([ch, n]) => /** @type {[string, number]} */ ([ch, (n / total) * 100]))
    .filter(([, p]) => p >= MIN_PERCENT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_LETTERS)
    .map(([ch, p]) => /** @type {[string, number]} */ ([ch, Math.round(p * 1e4) / 1e4]));
  return { letters, total };
}

/**
 * The CLDR language a FineFreq file is about: "swh_Latn" → "sw", "deu_Latn" → "de".
 *
 * @param {string} iso3 FineFreq's ISO 639-3 code
 * @param {Record<string, {_replacement?: string}>} aliases CLDR languageAlias
 */
export function cldrCode(iso3, aliases) {
  const a = aliases[iso3];
  const r = a && a._replacement;
  // "cnr" → "sr-ME" and the like: a region or script, not just a language.
  return r && /^[a-z]{2,3}$/.test(r) ? r : iso3;
}

/**
 * A country's Latin-script languages with letter data, largest first:
 * official ones (national, then regional). None when no national language
 * is written in Latin letters.
 *
 * @param {Record<string, {_populationPercent?: string, _officialStatus?: string}>} languages CLDR languagePopulation
 * @param {(lang: string) => string} scriptOf the script a code is written in ("sr_Latn" → "Latn")
 * @param {Set<string>} have languages with data
 * @returns {string[]}
 */
export function languagesFor(languages, scriptOf, have) {
  const rank = (/** @type {string} */ s) =>
    s === "official" || s === "de_facto_official" ? 0 : s === "official_regional" ? 1 : 2;
  const found = Object.entries(languages)
    .map(([code, v]) => ({
      code,
      lang: code.split("_")[0],
      pct: parseFloat(v._populationPercent || "0") || 0,
      rank: rank(v._officialStatus || ""),
    }))
    .filter((l) => l.rank < 2 && l.pct >= (l.rank ? 1 : 0.5) && scriptOf(l.code) === "Latn")
    .filter((l) => have.has(l.lang))
    .sort((a, b) => a.rank - b.rank || b.pct - a.pct);
  // A country whose national language isn't written in Latin letters isn't
  // a clue here, even if a regional one is (Turkmen in Afghanistan).
  if (!found.some((l) => l.rank === 0)) return [];
  return found
    .map((l) => l.lang)
    .filter((l, i, all) => all.indexOf(l) === i)
    .slice(0, 6);
}
