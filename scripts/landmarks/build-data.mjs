/**
 * Landmarks data — build apps/landmarks/data/<ISO>.json for every country.
 *
 * Run monthly by .github/workflows/landmarks-data.yml, which opens a pull
 * request with whatever changed. Landmarks hardly change, so most months the
 * diff is small: a few sitelink counts, the odd new photograph.
 *
 *   node scripts/landmarks/build-data.mjs            every country
 *   node scripts/landmarks/build-data.mjs FR JP      just these
 *
 * A country whose query fails keeps its previous file, and is listed in
 * index.json, so one bad night never wipes data.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTerritories } from "../../shared/cldr.js";
import { QLEVER, candidateQuery, detailQueries, mergeDetails } from "./query.js";
import { selectLandmarks } from "./select.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "apps/landmarks/data");
const UA = "geo-apps-landmarks/1.0 (https://github.com/ugerhard-git/geo-apps)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {string} text a SPARQL query */
async function sparql(text) {
  let last;
  const waits = process.env.LANDMARKS_QUICK ? [0] : [0, 10_000, 30_000];
  for (const wait of waits) {
    if (wait) await sleep(wait);
    try {
      const r = await fetch(QLEVER, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ query: text }),
        signal: AbortSignal.timeout(process.env.LANDMARKS_QUICK ? 90_000 : 180_000),
      });
      const reply = await r.text();
      if (process.env.LANDMARKS_QUICK) {
        let detail = "";
        if (!r.ok) {
          try {
            const j = JSON.parse(reply);
            detail = Object.entries(j)
              .map(([k, v]) => k + "=" + JSON.stringify(v).slice(0, 200))
              .join(" ; ");
          } catch {
            detail = reply.slice(0, 400);
          }
        }
        const head = text
          .slice(text.indexOf("SELECT"), text.indexOf("SELECT") + 40)
          .replace(/\s+/g, " ");
        console.log(
          `::notice title=timing::${head} → HTTP ${r.status}, ${reply.length} bytes ${detail.replace(/\s+/g, " ").slice(0, 1500)}`,
        );
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${reply.slice(0, 200)}`);
      const rows = JSON.parse(reply)?.results?.bindings;
      if (!Array.isArray(rows)) throw new Error("unexpected response");
      return rows;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/**
 * One country's rows: candidates, then details for them, with the sitelink
 * counts of step 1 joined on.
 *
 * @param {string} iso
 */
async function query(iso) {
  const cand = await sparql(candidateQuery(iso, 300));
  /** @type {Map<string, string>} */
  const sl = new Map();
  for (const r of cand) {
    const id = (/\/(Q\d+)$/.exec(r?.item?.value || "") || [])[1];
    if (id) sl.set(id, String(r?.sl?.value || "0"));
  }
  if (!sl.size) return [];
  const ids = [...sl.keys()];
  /** @type {Array<{part: string, rows: any[]}>} */
  const parts = [];
  for (let i = 0; i < ids.length; i += 100)
    for (const { part, query: text } of detailQueries(ids.slice(i, i + 100)))
      parts.push({ part, rows: await sparql(text) });
  return mergeDetails(parts, sl);
}

await mkdir(OUT, { recursive: true });
const wanted = process.argv.slice(2).filter((a) => /^[A-Z]{2}$/.test(a));
const countries = (await loadTerritories()).filter(
  (t) => !wanted.length || wanted.includes(t.code),
);

/** @type {Record<string, number>} */
const counts = {};
/** @type {string[]} */
const failed = [];
const started = Date.now();
for (const [i, t] of countries.entries()) {
  const t0 = Date.now();
  try {
    const rows = await query(t.code);
    const { kept, dropped } = selectLandmarks(rows, t.code);
    counts[t.code] = kept.length;
    const file = path.join(OUT, t.code + ".json");
    await writeFile(file, JSON.stringify({ country: t.code, items: kept }, null, 1) + "\n");
    const why = {};
    for (const d of dropped)
      why[d.reason.replace(/\d+/g, "n")] = (why[d.reason.replace(/\d+/g, "n")] || 0) + 1;
    if (process.env.GITHUB_ACTIONS && wanted.length)
      console.log(
        `::notice title=${t.code}::` +
          kept
            .slice(0, 25)
            .map(
              (k, n) =>
                `${n + 1}. ${k.name} [${k.sl}] ${k.kind}${k.whs ? " WHS" : ""}${k.also.length ? " ALSO " + k.also.join(",") : ""} (${k.types.join(", ")})`,
            )
            .join("%0A") +
          `%0ADropped: ` +
          dropped
            .slice(0, 15)
            .map((d) => `${d.name} [${d.sl}] → ${d.reason}`)
            .join("; "),
      );
    console.log(
      `${String(i + 1).padStart(3)}/${countries.length} ${t.code} ${t.name}: ${kept.length} kept, ` +
        `${dropped.length} dropped ${JSON.stringify(why)} · ${Date.now() - t0} ms · ` +
        kept
          .slice(0, 5)
          .map((k) => k.name)
          .join(", "),
    );
  } catch (e) {
    failed.push(t.code);
    console.log(`${t.code} ${t.name}: FAILED ${String(e && e.message).slice(0, 200)}`);
    // Keep the previous file's count in the index, if there is one.
    try {
      const old = JSON.parse(await readFile(path.join(OUT, t.code + ".json"), "utf8"));
      counts[t.code] = Array.isArray(old.items) ? old.items.length : 0;
    } catch {
      /* no previous file */
    }
  }
  await sleep(500); // be gentle with a free public service
}

// The index: which countries have data. Merged with the existing one, so a
// partial run (a few countries) doesn't forget the rest.
let index = { countries: {} };
try {
  index = JSON.parse(await readFile(path.join(OUT, "index.json"), "utf8"));
} catch {
  /* first run */
}
index.countries = Object.fromEntries(
  Object.entries({ ...(index.countries || {}), ...counts }).sort(([a], [b]) => a.localeCompare(b)),
);
index.source = "Wikidata via QLever, ranked by sitelinks";
index.updated = new Date().toISOString().slice(0, 10);
index.failed = failed;
await writeFile(path.join(OUT, "index.json"), JSON.stringify(index, null, 1) + "\n");
console.log(
  `Done: ${Object.keys(counts).length - failed.length} countries, ${failed.length} failed, ${Math.round((Date.now() - started) / 1000)} s`,
);
