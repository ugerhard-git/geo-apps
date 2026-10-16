#!/usr/bin/env node
/**
 * OWID chart plotter — reads each ready-made chart's source and years from
 * Our World in Data, to keep `apps/owid-chart-plotter/presets.js` accurate.
 *
 *   node scripts/owid/preset-info.mjs            print a table
 *   node scripts/owid/preset-info.mjs --json     print JSON, slug → info
 *
 * It only reads; copy what changed into the table in presets.js by hand. A chart whose
 * metadata can't be read is listed as failing, which usually means OWID
 * renamed it.
 */

import { PRESETS } from "../../apps/owid-chart-plotter/presets.js";

/**
 * The metadata address for a preset's slug, keeping any query it needs.
 *
 * @param {string} slug
 */
function metadataUrl(slug) {
  const [base, query] = slug.split("?");
  return `https://ourworldindata.org/grapher/${base}.metadata.json${query ? "?" + query : ""}`;
}

/**
 * The source and years of the chart's first column, which is the one the
 * app charts by default.
 *
 * @param {any} meta
 */
function infoFrom(meta) {
  const first = Object.values(meta?.columns || {})[0] || {};
  const years = String(first.timespan || "").replace("-", "–");
  return {
    title: String(meta?.chart?.title || ""),
    source: String(first.citationShort || ""),
    years,
  };
}

/** @type {Record<string, {title: string, source: string, years: string} | {error: string}>} */
const out = {};
for (const preset of PRESETS) {
  try {
    const r = await fetch(metadataUrl(preset.slug));
    if (!r.ok) throw new Error("HTTP " + r.status);
    out[preset.slug] = infoFrom(await r.json());
  } catch (err) {
    out[preset.slug] = { error: /** @type {Error} */ (err).message };
  }
  await new Promise((resolve) => setTimeout(resolve, 300)); // be polite to OWID
}

if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
else
  for (const [slug, info] of Object.entries(out))
    console.log(
      "error" in info ? `FAIL ${slug}: ${info.error}` : `${slug} | ${info.years} | ${info.source}`,
    );
