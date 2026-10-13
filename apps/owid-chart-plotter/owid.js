/**
 * OWID chart plotter — fetching a chart's CSV from Our World in Data.
 *
 * A dataset reference is "slug", "slug?query", "slug#Column" or
 * "slug?query#Column". OWID merges related charts into one multi-metric chart
 * (electricity-mix, energy-mix), selected by query params, so the query has to
 * survive; the optional #Column says which value column to chart when the CSV
 * carries several.
 */

/**
 * @param {string} value what the user typed, or a full grapher URL
 * @returns {{display: string, slug: string, colHint: string, base: string}}
 *   `display` for the input box, `slug` with its query, `colHint` the
 *   #Column, `base` the bare slug
 */
export function splitSlug(value) {
  const display = String(value || "")
    .trim()
    .replace(/^https?:\/\/[^/]+\/grapher\//, "")
    .replace(/\/+$/, "");
  const hash = display.indexOf("#");
  const colHint = hash >= 0 ? decodeURIComponent(display.slice(hash + 1)) : "";
  const slug = hash >= 0 ? display.slice(0, hash) : display;
  return { display, slug, colHint, base: slug.split("?")[0] };
}

/**
 * The CSV URLs to try for a slug, best first.
 *
 * @param {string} slug
 * @returns {string[]}
 */
export function csvUrls(slug) {
  const q = slug.indexOf("?");
  const base = q >= 0 ? slug.slice(0, q) : slug;
  const extra = q >= 0 ? slug.slice(q + 1) : "";
  const root = "https://ourworldindata.org/grapher/" + base + ".csv";
  return [
    root + "?csvType=full&useColumnShortNames=false" + (extra ? "&" + extra : ""),
    extra ? root + "?" + extra : root,
  ];
}

/**
 * Fetch a slug's CSV text, trying both URL forms. Throws with a readable
 * message.
 *
 * A cross-origin error page (e.g. OWID's 404) is blocked by the browser before
 * its status can be read, surfacing only as "Failed to fetch" — so a
 * network-level rejection means EITHER the chart does not exist OR the request
 * genuinely failed. It is retried before concluding anything, to rule out a
 * transient hiccup.
 *
 * @param {string} slug
 * @returns {Promise<string>}
 */
export async function fetchCSV(slug) {
  let httpErr = null;
  const backoff = [700, 1800]; // three attempts in total
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    for (const u of csvUrls(slug)) {
      try {
        const res = await fetch(u);
        if (!res.ok) {
          httpErr = new Error("HTTP " + res.status + " — that slug is wrong.");
          continue;
        }
        return await res.text();
      } catch {
        /* network-level rejection; fall through to retry */
      }
    }
    if (httpErr) break; // a real answer; retrying won't help
    if (attempt < backoff.length) await new Promise((r) => setTimeout(r, backoff[attempt]));
  }
  if (httpErr) throw httpErr;
  throw new Error(
    "No CSV came back after 3 tries. OWID's error responses carry no CORS " +
      "headers, so the browser hides the status from us. Open ourworldindata.org/grapher/" +
      slug.split("?")[0] +
      " — it will be one of: the chart is gone (404); it redirects to a " +
      "merged chart, in which case copy the params from its Data URL (e.g. " +
      "“literacy?age_group=adult&sex=both”); or the page says the data cannot be " +
      "downloaded because of its licence, and no slug will help.",
  );
}
