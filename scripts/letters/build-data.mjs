/**
 * Letter frequencies — build apps/letters/data/letters.json from FineFreq.
 *
 * FineFreq (Binbin Xu, 2025; CC BY 4.0) publishes character counts per
 * language from FineWeb and FineWeb2 — 96.6 trillion characters of Common
 * Crawl text, 2013–2025. This script counts nothing itself: it keeps each
 * language's letters, folds case and turns the counts into shares
 * (select.js). It runs by hand; the result is committed.
 *
 *   git clone --depth 1 --filter=blob:none --sparse https://github.com/Bin-2/FineFreq.git finefreq
 *   (cd finefreq && git sparse-checkout set manifest)
 *   node scripts/letters/build-data.mjs finefreq <cldr-core>/supplemental <languages.json>
 *
 * The first run lists the csv/ files it needs; check them out
 * (git sparse-checkout add …) and run again. <languages.json> is
 * cldr-localenames-full's main/en/languages.json, for English names.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cldrCode, languagesFor, letterShares, parseCsv } from "./select.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "apps/letters/data/letters.json");

const [ffDir, suppDir, namesPath] = process.argv.slice(2);
if (!ffDir || !suppDir || !namesPath) {
  console.error("usage: build-data.mjs <finefreq> <cldr-core/supplemental> <languages.json>");
  process.exit(1);
}
const json = async (/** @type {string} */ p) => JSON.parse(await readFile(p, "utf8"));
const aliases = (await json(path.join(suppDir, "aliases.json"))).supplemental.metadata.alias
  .languageAlias;
const likely = (await json(path.join(suppDir, "likelySubtags.json"))).supplemental.likelySubtags;
const territories = (await json(path.join(suppDir, "territoryInfo.json"))).supplemental
  .territoryInfo;
const names = (await json(namesPath)).main.en.localeDisplayNames.languages;

/** "sr_Latn" → "Latn"; "sw" → its likely script. */
const scriptOf = (/** @type {string} */ code) => {
  const [, script] = code.split("_");
  if (script) return script;
  const l = likely[code];
  return l ? l.split("-")[1] : "";
};

// FineFreq's Latin-script files, one per CLDR language: the largest when
// several map to the same one (Swahili and Congo Swahili, say).
const manifest = parseCsv(await readFile(path.join(ffDir, "manifest/languages.csv"), "utf8"));
/** @type {Map<string, {file: string, name: string, size: number}>} */
const files = new Map();
for (const m of manifest) {
  if (m.script !== "Latn" || !/^[a-z]{3}_Latn$/.test(m.language_code)) continue;
  const code = cldrCode(m.iso_639_3, aliases);
  const size = Number(m.total_frequency) || 0;
  const had = files.get(code);
  if (!had || size > had.size)
    files.set(code, { file: m.language_code, name: m.language_name, size });
}

/** @type {Record<string, string[]>} */
const countries = {};
for (const [cc, t] of Object.entries(territories)) {
  if (!/^[A-Z]{2}$/.test(cc) || cc === "ZZ") continue;
  const langs = languagesFor(t.languagePopulation || {}, scriptOf, new Set(files.keys()));
  if (langs.length) countries[cc] = langs;
}

const needed = [...new Set(Object.values(countries).flat())].sort();
const missing = needed.filter(
  (l) => !existsSync(path.join(ffDir, "csv", files.get(l).file + ".csv")),
);
if (missing.length) {
  console.error(
    `Check these out first:\n  git -C ${ffDir} sparse-checkout add ` +
      missing.map((l) => `csv/${files.get(l).file}.csv`).join(" "),
  );
  process.exit(2);
}

/** @type {Record<string, {name: string, source: string, letters: number, top: Array<[string, number]>}>} */
const languages = {};
for (const lang of needed) {
  const f = /** @type {{file: string, name: string}} */ (files.get(lang));
  const rows = parseCsv(await readFile(path.join(ffDir, "csv", f.file + ".csv"), "utf8"));
  const { letters, total } = letterShares(rows, lang);
  if (letters.length < 15) {
    console.warn(`${lang}: only ${letters.length} letters, left out`);
    continue;
  }
  languages[lang] = { name: names[lang] || f.name, source: f.file, letters: total, top: letters };
}
for (const cc of Object.keys(countries)) {
  countries[cc] = countries[cc].filter((l) => languages[l]);
  if (!countries[cc].length) delete countries[cc];
}

// One language and one country per line, so a diff shows what changed.
/** @param {Record<string, unknown>} obj */
const lines = (obj) =>
  "{\n" +
  Object.entries(obj)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(",\n") +
  "\n }";
await mkdir(path.dirname(OUT), { recursive: true });
const source =
  "FineFreq (Xu 2025, arXiv:2512.09701), CC BY 4.0: character counts from FineWeb / FineWeb2 (Common Crawl 2013–2025)";
await writeFile(
  OUT,
  `{\n "source": ${JSON.stringify(source)},\n "languages": ${lines(languages)},\n "countries": ${lines(countries)}\n}\n`,
);
console.log(
  `${Object.keys(languages).length} languages, ${Object.keys(countries).length} countries`,
);
