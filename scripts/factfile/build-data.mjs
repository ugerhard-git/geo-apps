#!/usr/bin/env node
/**
 * Fact file — builds apps/factfile/data/ from the archived CIA World
 * Factbook (github.com/factbook/factbook.json, CC0).
 *
 *   node scripts/factfile/build-data.mjs <factbook.json checkout> [country-codes.csv]
 *
 * The Factbook stopped in February 2026, so this runs once rather than on a
 * schedule. Its files are named by GEC codes ("gm" is Germany, "ng" Niger),
 * which are matched to ISO codes through the datasets/country-codes table,
 * the same crosswalk the Statistics app uses, and spot-checked.
 *
 * Writes one file per country, `data/<ISO>.json`, plus `data/index.json`
 * with the list of countries and every country's name and adjective (so the
 * app can tell another country's name from a place in this one).
 */

import { readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { demonym, extract } from "./extract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "apps/factfile/data");
const CODES_URL =
  "https://raw.githubusercontent.com/datasets/country-codes/main/data/country-codes.csv";

/** Folders that hold no countries. */
const SKIP = new Set(["meta", "oceans", "world", "antarctica"]);

/** GEC codes the crosswalk lacks, mapped by hand. */
const EXTRA = { kv: "XK", ri: "RS", sv: "SJ" };

/** Pairs that must come out right, or the build stops. */
const SPOT_CHECK = [
  ["gm", "DE"],
  ["au", "AT"],
  ["as", "AU"],
  ["ng", "NE"],
  ["ni", "NG"],
  ["sf", "ZA"],
  ["ja", "JP"],
  ["ri", "RS"],
];

const [dir, codesPath] = process.argv.slice(2);
if (!dir) {
  console.error("usage: build-data.mjs <factbook.json checkout> [country-codes.csv]");
  process.exit(1);
}

/**
 * The GEC → ISO table.
 *
 * @returns {Promise<Map<string, string>>}
 */
async function crosswalk() {
  const text = codesPath
    ? await readFile(codesPath, "utf8")
    : await (await fetch(CODES_URL)).text();
  const rows = text
    .split(/\r?\n/)
    .map(
      (l) =>
        l
          .match(/("([^"]|"")*"|[^,]*)(,|$)/g)
          ?.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "")) || [],
    );
  const head = rows[0];
  const iFips = head.indexOf("FIPS");
  const iIso = head.indexOf("ISO3166-1-Alpha-2");
  if (iFips < 0 || iIso < 0) throw new Error("the country-codes table has changed its columns");
  /** @type {Map<string, string>} */
  const map = new Map(Object.entries(EXTRA));
  for (const r of rows.slice(1)) {
    const fips = (r[iFips] || "").toLowerCase();
    const iso = (r[iIso] || "").toUpperCase();
    if (/^[a-z0-9]{2}$/.test(fips) && /^[A-Z]{2}$/.test(iso)) map.set(fips, iso);
  }
  for (const [gec, iso] of SPOT_CHECK)
    if (map.get(gec) !== iso) throw new Error(`crosswalk check failed: ${gec} should be ${iso}`);
  return map;
}

const codes = await crosswalk();

/** @type {Array<{iso: string, gec: string, profile: any}>} */
const profiles = [];
for (const folder of (await readdir(dir)).sort()) {
  if (SKIP.has(folder)) continue;
  let files;
  try {
    files = await readdir(path.join(dir, folder));
  } catch {
    continue;
  }
  for (const file of files.sort()) {
    const m = /^([a-z0-9]{2})\.json$/.exec(file);
    if (!m) continue;
    const iso = codes.get(m[1]);
    if (!iso) {
      console.warn(`skipped ${folder}/${file}: no ISO code`);
      continue;
    }
    profiles.push({
      iso,
      gec: m[1],
      profile: JSON.parse(await readFile(path.join(dir, folder, file), "utf8")),
    });
  }
}

// Every country's name and adjective: a neighbour is blacked out by both.
/** @type {Map<string, string>} */
const adjectiveOf = new Map();
/** @type {Set<string>} */
const known = new Set();
for (const { profile } of profiles) {
  const d = demonym(profile);
  if (!d) continue;
  adjectiveOf.set(d.name, d.adjective);
  known.add(d.name);
  if (d.adjective) known.add(d.adjective);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
/** @type {Record<string, string>} */
const index = {};
let fieldCount = 0;
for (const { iso, gec, profile } of profiles) {
  const { names, fields } = extract(profile);
  if (Object.keys(fields).length < 3) {
    console.warn(`skipped ${iso}: too little in its profile`);
    continue;
  }
  names.neighbours = [
    ...new Set(names.neighbours.flatMap((n) => [n, adjectiveOf.get(n) || ""]).filter(Boolean)),
  ];
  fieldCount += Object.keys(fields).length;
  const record = { code: iso, names, fields };
  // One field per line, so a diff shows what changed.
  const body =
    "{\n" +
    Object.entries(record)
      .map(([k, v]) =>
        k === "fields"
          ? ` "fields": {\n${Object.entries(v)
              .map(([fk, fv]) => `  ${JSON.stringify(fk)}: ${JSON.stringify(fv)}`)
              .join(",\n")}\n }`
          : ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
      )
      .join(",\n") +
    "\n}\n";
  await writeFile(path.join(OUT, `${iso}.json`), body);
  index[iso] = gec;
}

const count = Object.keys(index).length;
if (count < 200) throw new Error(`only ${count} countries were read; is this the right folder?`);
await writeFile(
  path.join(OUT, "index.json"),
  `{\n "source": "CIA World Factbook, archived January 2026 (github.com/factbook/factbook.json), public domain",\n "countries": ${JSON.stringify(index)},\n "known": ${JSON.stringify([...known].sort())}\n}\n`,
);
console.log(`${count} countries, ${(fieldCount / count).toFixed(1)} fields each on average`);
