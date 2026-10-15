/**
 * Baby names — build apps/names/data/names.json from Wikipedia's
 * "List of most popular given names".
 *
 * Run monthly by .github/workflows/names-data.yml, which opens a pull
 * request when anything changed, so nothing reaches the site unreviewed.
 *
 *   node scripts/names/build-data.mjs                 fetch the page from Wikipedia
 *   node scripts/names/build-data.mjs page.json       use a saved API reply instead
 *
 * The parsing rules are in parse.js. Countries are matched by their English
 * CLDR name; only whole countries are kept.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTerritories, parseTerritories } from "../../shared/cldr.js";
import { bareName } from "../../shared/text.js";
import { namesByCountry } from "./parse.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "apps/names/data/names.json");
const PAGE = "List_of_most_popular_given_names";
const API =
  "https://en.wikipedia.org/w/api.php?action=parse&page=" +
  PAGE +
  "&prop=wikitext%7Crevid&format=json&formatversion=2";
const UA = "geo-apps-names/1.0 (https://github.com/ugerhard-git/geo-apps)";

/** Names the page uses that CLDR spells otherwise. Never "England" → GB: only whole countries. */
const EXTRA = { "ivory coast": "CI", "czech republic": "CZ", "east timor": "TL", turkey: "TR" };

const [pageFile, territoriesFile] = process.argv.slice(2);
const reply = pageFile
  ? JSON.parse(await readFile(pageFile, "utf8"))
  : await (
      await fetch(API, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) })
    ).json();
const wikitext = reply && reply.parse && reply.parse.wikitext;
const revid = reply && reply.parse && reply.parse.revid;
if (typeof wikitext !== "string" || wikitext.length < 10_000)
  throw new Error("unexpected reply from Wikipedia");

const territories = territoriesFile
  ? parseTerritories(JSON.parse(await readFile(territoriesFile, "utf8")))
  : await loadTerritories();
/** @type {Map<string, string>} */
const byName = new Map();
for (const t of territories) for (const n of [t.name, ...t.alts]) byName.set(bareName(n), t.code);
for (const [k, v] of Object.entries(EXTRA)) byName.set(k, v);
const codeOf = (/** @type {string} */ n) => byName.get(bareName(n)) || "";

const { countries, dropped } = namesByCountry(wikitext, codeOf);
const count = Object.keys(countries).length;
if (count < 60) throw new Error(`only ${count} countries parsed — has the page's layout changed?`);

const data = {
  source: {
    title: "List of most popular given names",
    url: "https://en.wikipedia.org/wiki/" + PAGE,
    revid: Number.isInteger(revid) ? revid : 0,
    licence: "CC BY-SA 4.0",
  },
  countries: Object.fromEntries(Object.entries(countries).sort(([a], [b]) => a.localeCompare(b))),
};

// One country per line, so a diff shows what changed.
const body = Object.entries(data.countries)
  .map(([cc, v]) => `  ${JSON.stringify(cc)}: ${JSON.stringify(v)}`)
  .join(",\n");
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  `{\n "source": ${JSON.stringify(data.source)},\n "countries": {\n${body}\n }\n}\n`,
);
console.log(
  `${count} countries from revision ${data.source.revid}; ${dropped.length} rows left out:`,
);
for (const d of dropped) console.log("  " + d);
