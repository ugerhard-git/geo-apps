/**
 * Day length — build apps/day-length/data/capitals.json: each country's
 * capital, with its position and time zone, from GeoNames (CC BY 4.0).
 *
 *   node scripts/day-length/build-data.mjs                  download cities1000.zip
 *   node scripts/day-length/build-data.mjs cities1000.txt   use a file you already have
 *
 * The download is a zip, unpacked with the system's `unzip`. Capitals rarely
 * move, so this is run by hand when needed; the app only reads the result.
 * The rules for picking a capital are in parse.js.
 */

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCapitals } from "./parse.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "apps/day-length/data/capitals.json");
const URL = "https://download.geonames.org/export/dump/cities1000.zip";

let tsv;
const [file] = process.argv.slice(2);
if (file) tsv = await readFile(file, "utf8");
else {
  const res = await fetch(URL, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`GeoNames: HTTP ${res.status}`);
  const dir = await mkdtemp(path.join(tmpdir(), "geonames-"));
  const zip = path.join(dir, "cities1000.zip");
  await writeFile(zip, Buffer.from(await res.arrayBuffer()));
  tsv = execFileSync("unzip", ["-p", zip, "cities1000.txt"], {
    maxBuffer: 200 * 1024 * 1024,
  }).toString("utf8");
}

const capitals = parseCapitals(tsv);
const count = Object.keys(capitals).length;
// About 240 countries and territories have a capital in the list; far fewer
// means the download went wrong, and the file is better left as it was.
if (count < 200) throw new Error(`only ${count} capitals found`);

const body = Object.entries(capitals)
  .map(([cc, c]) => `  ${JSON.stringify(cc)}: ${JSON.stringify(c)}`)
  .join(",\n");
const source = {
  name: "GeoNames, places with at least 1,000 inhabitants (cities1000)",
  url: "https://www.geonames.org/",
  licence: "CC BY 4.0",
  built: new Date().toISOString().slice(0, 10),
};
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `{\n "source": ${JSON.stringify(source)},\n "capitals": {\n${body}\n }\n}\n`);
console.log(`${count} capitals → ${path.relative(ROOT, OUT)}`);
