/**
 * Keyboard layouts — build apps/keyboards/data/layouts.json.
 *
 * The Windows keyboard layouts were published by the Unicode CLDR project up
 * to release 43 (later releases replaced them with a new format that covers
 * only a few keyboards). They don't change any more, so this runs by hand,
 * once, and the result is committed:
 *
 *   git clone --depth 1 --filter=blob:none --sparse -b release-43 \
 *     https://github.com/unicode-org/cldr.git cldr43
 *   (cd cldr43 && git sparse-checkout set keyboards)
 *   node scripts/keyboards/build-data.mjs cldr43/keyboards/windows [territoryInfo.json]
 *
 * Without a territoryInfo.json path, CLDR's is fetched from jsDelivr.
 *
 * Which layouts a country uses comes from CLDR's languages per territory,
 * corrected by hand in countries.js where the language alone gets it wrong.
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutsFor } from "./countries.js";
import { isAnsi, layoutId, parseLayout } from "./parse.js";
import { LATIN_BESIDE, PRINTED } from "./printed.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "apps/keyboards/data/layouts.json");
const TERRITORY_INFO = "https://cdn.jsdelivr.net/npm/cldr-core@47/supplemental/territoryInfo.json";

const [dir, infoPath] = process.argv.slice(2);
if (!dir) {
  console.error("usage: build-data.mjs <cldr43/keyboards/windows> [territoryInfo.json]");
  process.exit(1);
}

/** @type {Record<string, {name: string, shape: string, keys: Record<string, string[]>, dead: string, latin?: string}>} */
const layouts = {};
for (const file of (await readdir(dir)).sort()) {
  const id = layoutId(file);
  if (!id) continue;
  const l = parseLayout(await readFile(path.join(dir, file), "utf8"));
  if (Object.keys(l.keys).length < 30) {
    console.warn(`skipped ${id}: only ${Object.keys(l.keys).length} keys`);
    continue;
  }
  layouts[id] = {
    name: l.name,
    shape: isAnsi(l.keys) ? "ansi" : "iso",
    keys: l.keys,
    dead: l.dead,
  };
}

// The hand-made ones: Latin legends from a Windows layout (or a table), plus
// the printed characters in slots 4 and 5.
for (const p of PRINTED) {
  /** @type {Record<string, string[]>} */
  const keys = {};
  if (typeof p.latin === "string") {
    for (const [pos, k] of Object.entries(layouts[p.latin].keys)) keys[pos] = k.slice(0, 2);
    if (p.shape !== "iso") delete keys.B00;
  } else {
    for (const [pos, v] of Object.entries(p.latin))
      keys[pos] = [...v.split(" "), "", ""].slice(0, 2);
  }
  for (const [pos, v] of Object.entries(p.printed)) {
    const [a, b = ""] = v.split(" ");
    keys[pos] = [...(keys[pos] || ["", ""]), "", ""].slice(0, 4).concat([a, b]);
  }
  layouts[p.id] = { name: p.name, shape: p.shape, keys, dead: "" };
}

// Trailing empty layers aren't stored.
for (const l of Object.values(layouts))
  for (const [pos, k] of Object.entries(l.keys)) {
    while (k.length && !k[k.length - 1]) k.pop();
    if (!k.length) delete l.keys[pos];
  }

const info = infoPath
  ? JSON.parse(await readFile(infoPath, "utf8"))
  : await (await fetch(TERRITORY_INFO)).json();
const territories = info.supplemental.territoryInfo;
/** @type {Record<string, string[]>} */
const countries = {};
for (const [cc, t] of Object.entries(territories)) {
  if (!/^[A-Z]{2}$/.test(cc) || cc === "ZZ") continue;
  const ids = layoutsFor(cc, t.languagePopulation || {}, Object.keys(layouts));
  if (ids.length) countries[cc] = ids;
}

// Only the layouts some country uses are shipped, plus the Latin ones
// printed beside others.
for (const [id, latin] of Object.entries(LATIN_BESIDE)) if (layouts[id]) layouts[id].latin = latin;
const used = new Set([...Object.values(countries).flat(), "en", ...Object.values(LATIN_BESIDE)]);
for (const id of Object.keys(layouts)) if (!used.has(id)) delete layouts[id];

await mkdir(path.dirname(OUT), { recursive: true });
const data = {
  source:
    "Unicode CLDR 43 (Windows keyboard layouts), Unicode License v3; CJK printed legends entered by hand",
  layouts,
  countries,
};
// One layout and one country per line, so a diff shows what changed.
/** @param {Record<string, unknown>} obj */
const lines = (obj) =>
  "{\n" +
  Object.entries(obj)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(",\n") +
  "\n }";
await writeFile(
  OUT,
  `{\n "source": ${JSON.stringify(data.source)},\n "layouts": ${lines(layouts)},\n "countries": ${lines(countries)}\n}\n`,
);
console.log(
  `${Object.keys(layouts).length} layouts, ${Object.keys(countries).length} countries, ${(JSON.stringify(data).length / 1024).toFixed(0)} KB`,
);
