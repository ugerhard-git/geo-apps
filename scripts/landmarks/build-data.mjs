/**
 * Landmarks data — build apps/landmarks/data/<ISO>.json for every country.
 *
 * Run monthly by .github/workflows/landmarks-data.yml, which opens a pull
 * request with whatever changed. Landmarks hardly change, so most months the
 * diff is small: a few sitelink counts, the odd new photograph.
 *
 *   node scripts/landmarks/build-data.mjs            every country
 *   node scripts/landmarks/build-data.mjs FR JP      just these
 *   node scripts/landmarks/build-data.mjs --part=2/6 every sixth country,
 *                                                    starting with the second
 *   node scripts/landmarks/build-data.mjs --minutes=200
 *                                                    stop starting countries
 *                                                    after 200 minutes
 *
 * The workflow runs the countries in parts, one job after another, each with
 * a time budget below GitHub's limit for a job: QLever has grown slower than
 * one job can wait for. A country not reached keeps its previous file.
 *
 * A country whose query fails keeps its previous file, and is listed in
 * index.json, so one bad night never wipes data.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTerritories } from "../../shared/cldr.js";
import {
  QLEVER,
  candidateQuery,
  detailQueries,
  mergeDetails,
  parentQuery,
  withinQuery,
} from "./query.js";
import { selectLandmarks } from "./select.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "apps/landmarks/data");
const UA = "geo-apps-landmarks/1.0 (https://github.com/ugerhard-git/geo-apps)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** QLever is a free public service: at most one query every PACE_MS. */
const PACE_MS = 1500;

/** Fewer candidates than this and a place is searched by location as well. */
const FEW = 30;
let lastQuery = 0;

/** A query QLever gave up on: not worth asking again. */
class QueryTimeout extends Error {}

/** @param {string} text a SPARQL query */
async function sparql(text) {
  let last;
  let wait = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (wait) await sleep(wait);
    await sleep(Math.max(0, lastQuery + PACE_MS - Date.now()));
    lastQuery = Date.now();
    try {
      const r = await fetch(QLEVER, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ query: text }),
        signal: AbortSignal.timeout(120_000),
      });
      const reply = await r.text();
      // QLever answers a query that ran out of time with a 429 and a JSON
      // error. The same query will run out of time again, so it isn't retried.
      if (r.status === 429 && reply.startsWith("{") && /timed out/i.test(reply))
        throw new QueryTimeout(`query timed out: ${reply.slice(0, 200)}`);
      if (r.status === 429 && !reply.startsWith("{")) {
        // Rate-limited (an HTML page), as opposed to a query timeout (JSON).
        const after = parseInt(r.headers.get("retry-after") || "", 10);
        wait =
          Number.isFinite(after) && after > 0
            ? Math.min(after, 300) * 1000
            : 30_000 * (attempt + 1);
        last = new Error("rate-limited");
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${reply.slice(0, 200)}`);
      const rows = JSON.parse(reply)?.results?.bindings;
      if (!Array.isArray(rows)) throw new Error("unexpected response");
      return rows;
    } catch (e) {
      if (e instanceof QueryTimeout) throw e;
      last = e;
      wait = 10_000 * (attempt + 1);
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
  /** @type {Map<string, string>} */
  const sl = new Map();
  /** @param {any[]} rows */
  const add = (rows) => {
    for (const r of rows) {
      const id = (/\/(Q\d+)$/.exec(r?.item?.value || "") || [])[1];
      if (id && !sl.has(id)) sl.set(id, String(r?.sl?.value || "0"));
    }
  };
  add(await sparql(candidateQuery(iso, 300)));
  /** @type {string[]} */
  let parents = [];
  if (sl.size < FEW) {
    // Probably a territory whose landmarks name its parent country.
    add(await sparql(withinQuery(iso, 300)));
    parents = (await sparql(parentQuery(iso)))
      .map((r) => String(r?.p?.value || ""))
      .filter((c) => /^[A-Z]{2}$/.test(c) && c !== iso);
  }
  if (!sl.size) return { rows: [], parents };
  const ids = [...sl.keys()];
  /** @type {Array<{part: string, rows: any[]}>} */
  const parts = [];
  for (const { part, query: text } of detailQueries(ids)) {
    if (part === "labels") continue;
    parts.push({ part, rows: await sparql(text) });
  }
  // Names in other languages, only for the items without an English one.
  const named = new Set(
    parts
      .filter((p) => p.part === "basic")
      .flatMap((p) => p.rows)
      .filter((r) => r?.en?.value)
      .map((r) => (/\/(Q\d+)$/.exec(r?.item?.value || "") || [])[1]),
  );
  const unnamed = ids.filter((id) => !named.has(id));
  if (unnamed.length) {
    const labels = detailQueries(unnamed).find((p) => p.part === "labels");
    if (labels) parts.push({ part: "labels", rows: await sparql(labels.query) });
  }
  return { rows: mergeDetails(parts, sl), parents };
}

await mkdir(OUT, { recursive: true });
const args = process.argv.slice(2);
const wanted = args.filter((a) => /^[A-Z]{2}$/.test(a));
// --part=K/N: the countries whose place in the list, counted from 1, leaves
// K when divided by N (K = N for none left), so each part gets a mix of big
// and small countries.
const part = /^--part=(\d+)\/(\d+)$/.exec(args.find((a) => a.startsWith("--part=")) || "");
const [k, n] = part ? [Number(part[1]), Number(part[2])] : [1, 1];
if (part && !(n >= 1 && k >= 1 && k <= n)) throw new Error("--part must be K/N with 1 ≤ K ≤ N");
const minutesArg = /^--minutes=(\d+)$/.exec(args.find((a) => a.startsWith("--minutes=")) || "");
const budgetMs = minutesArg ? Number(minutesArg[1]) * 60_000 : Infinity;
const countries = (await loadTerritories())
  .filter((t) => !wanted.length || wanted.includes(t.code))
  .filter((_, i) => i % n === k - 1);

/** @type {Record<string, number>} */
const counts = {};
/** @type {string[]} */
const failed = [];
/** @type {string[]} */
const skipped = [];
const started = Date.now();
for (const [i, t] of countries.entries()) {
  if (Date.now() - started > budgetMs) {
    skipped.push(...countries.slice(i).map((c) => c.code));
    break;
  }
  const t0 = Date.now();
  try {
    const { rows, parents } = await query(t.code);
    const { kept, dropped } = selectLandmarks(rows, t.code, parents);
    counts[t.code] = kept.length;
    const file = path.join(OUT, t.code + ".json");
    await writeFile(file, JSON.stringify({ country: t.code, items: kept }, null, 1) + "\n");
    const why = {};
    for (const d of dropped)
      why[d.reason.replace(/\d+/g, "n")] = (why[d.reason.replace(/\d+/g, "n")] || 0) + 1;
    // For a partial run, the top of each list as an annotation. Names come
    // from a wiki, so "%" and line breaks are escaped: the runner must see
    // one command, with plain text in it.
    /** @param {string} x */
    const esc = (x) => x.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    if (process.env.GITHUB_ACTIONS && wanted.length)
      console.log(
        `::notice title=${t.code}::` +
          kept
            .slice(0, 25)
            .map(
              (k, n) =>
                `${n + 1}. ${esc(k.name)} [${k.sl}] ${k.kind}${k.whs ? " WHS" : ""}${k.also.length ? " ALSO " + k.also.join(",") : ""} (${esc(k.types.join(", "))})`,
            )
            .join("%0A") +
          `%0ADropped: ` +
          dropped
            .slice(0, 15)
            .map((d) => `${esc(d.name)} [${d.sl}] → ${d.reason}`)
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
    if (process.env.GITHUB_ACTIONS)
      console.log(
        `::warning title=${t.code} failed::${String((e && e.stack) || e)
          .slice(0, 800)
          .replace(/%/g, "%25")
          .replace(/\r/g, "%0D")
          .replace(/\n/g, "%0A")}`,
      );
    // Keep the previous file's count in the index, if there is one.
    try {
      const old = JSON.parse(await readFile(path.join(OUT, t.code + ".json"), "utf8"));
      counts[t.code] = Array.isArray(old.items) ? old.items.length : 0;
    } catch {
      /* no previous file */
    }
  }
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
// Failures from earlier parts or runs stay listed unless this run did them again.
const done = new Set(countries.map((c) => c.code).filter((c) => !skipped.includes(c)));
index.failed = [
  ...(index.failed || []).filter((/** @type {string} */ c) => !done.has(c)),
  ...failed,
].sort();
await writeFile(path.join(OUT, "index.json"), JSON.stringify(index, null, 1) + "\n");
console.log(
  `Done: ${Object.keys(counts).length - failed.length} countries, ${failed.length} failed, ${Math.round((Date.now() - started) / 1000)} s`,
);
if (skipped.length) {
  const msg = `Out of time: ${skipped.length} countries not reached, kept as they were: ${skipped.join(" ")}`;
  console.log(process.env.GITHUB_ACTIONS ? `::warning title=Not reached::${msg}` : msg);
}
