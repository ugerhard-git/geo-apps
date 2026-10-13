/**
 * Currency sheets — facts and the illustration from the currency's English
 * Wikipedia article.
 */

import { classifyLicence, firstSafeImageUrl } from "../../shared/commons.js";
import { cleanText, htmlToText } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import { fetchInfobox, wikipedia } from "../../shared/wikipedia.js";
import { describeRejectedUrl, fileInfo, yearInTitle } from "./commons-data.js";
import { FULL_W, SAFE_LABELS } from "./config.js";

/** @typedef {import("./reference.js").Currency} Currency */
/** @typedef {import("./commons-data.js").Piece} Piece */

/**
 * @typedef {object} InfoRow
 * @property {string} label
 * @property {string} value
 * @property {string} key the label in lower case
 * @property {boolean} safe may go on the sheet without naming the currency
 */

/**
 * @typedef {object} CurrencyInfo
 * @property {string} title
 * @property {string} url
 * @property {InfoRow[]} rows
 * @property {string} leadImage the illustration's file name, or ""
 * @property {string[]} leadCandidates every name the illustration may go by
 * @property {string} leadImageVia how it was found, for the facts panel
 */

/**
 * @typedef {object} FactRow
 * @property {string} label
 * @property {string} value
 * @property {boolean} [reveal] names the currency outright
 * @property {boolean} [withheld] known, but not on the sheet
 */

/* Articles may have two-letter titles ("Rand"), unlike the shared check. */
const TITLE_OK = /^[^\n\r|#<>[\]{}]{2,120}$/;

/**
 * Plausible article titles for a currency.
 *
 * CLDR title-cases currency names — "Thai Baht", "US Dollar" — while articles
 * use sentence case and sometimes a different name entirely. Generate the
 * plausible spellings rather than betting on one.
 *
 * @param {Currency} currency
 * @returns {string[]}
 */
function articleCandidates(currency) {
  // "US Dollar" becomes "US dollar", but "United States Dollar" has to become
  // "United States dollar" — so lowercase the last word as well as all of them.
  /** @param {string} t */
  const lastLower = (t) => t.replace(/\s(\S+)$/, (m, w) => " " + w.toLowerCase());
  /** @param {string} t */
  const allLower = (t) => t.replace(/\s+\S/g, (m) => m.toLowerCase());

  const seeds = [];
  for (const seed of [currency.name, currency.plural].filter(Boolean)) {
    seeds.push(seed);
    if (/^US\b/.test(seed)) seeds.push(seed.replace(/^US\b/, "United States"));
  }
  const out = [];
  for (const seed of seeds) out.push(seed, lastLower(seed), allLower(seed));
  return [...new Set(out)].filter((t) => TITLE_OK.test(t)).slice(0, 10);
}

/**
 * Article titles worth trying, best first: existing titles, then search
 * results.
 *
 * @param {Currency} currency
 * @returns {Promise<string[]>}
 */
async function findCurrencyArticles(currency) {
  /** @type {string[]} */
  const ordered = [];
  const cands = articleCandidates(currency);
  if (cands.length) {
    const data = await wikipedia({ action: "query", titles: cands.join("|"), redirects: "1" });
    const pages = (data && data.query && data.query.pages) || [];
    const live = pages.filter(
      (/** @type {any} */ pg) => pg && !pg.missing && typeof pg.title === "string",
    );
    for (const c of cands) {
      const hit = live.find((/** @type {any} */ pg) => pg.title === c);
      if (hit && !ordered.includes(hit.title)) ordered.push(hit.title);
    }
    for (const pg of live) if (!ordered.includes(pg.title)) ordered.push(pg.title);
  }
  try {
    const found = await wikipedia({
      action: "query",
      list: "search",
      srnamespace: "0",
      srlimit: "5",
      srsearch: `${currency.name} currency`,
    });
    for (const r of (found && found.query && found.query.search) || [])
      if (typeof r.title === "string" && !ordered.includes(r.title)) ordered.push(r.title);
  } catch {
    /* the title lookup may already have been enough */
  }
  return ordered.slice(0, 8);
}

/**
 * The image MediaWiki chose to represent a page — for a currency article, the
 * infobox illustration. Scraping the rendered HTML is the fallback, because
 * markup changes and an API contract doesn't.
 *
 * @param {string} title
 * @returns {Promise<string>} a file name, or ""
 */
async function pageImageName(title) {
  try {
    const data = await wikipedia({
      action: "query",
      prop: "pageimages",
      piprop: "name",
      // The default is "free", which returns nothing at all for a non-free
      // illustration — the licence is reported later rather than filtered here.
      pilicense: "any",
      titles: title,
      redirects: "1",
    });
    const pages = (data && data.query && data.query.pages) || [];
    const name = pages.length && typeof pages[0].pageimage === "string" ? pages[0].pageimage : "";
    if (!name) return "";
    let out = String(name);
    // The API returns raw names, but decode defensively in case one arrives escaped.
    if (/%[0-9a-f]{2}/i.test(out)) {
      try {
        out = decodeURIComponent(out);
      } catch {
        /* keep as-is */
      }
    }
    return cleanText(out.replace(/_/g, " "), 160);
  } catch {
    return "";
  }
}

/**
 * Recover the file name from a rendered thumbnail path, whichever wiki hosts
 * it. An earlier version discarded /wikipedia/en/ paths because only Commons
 * files could be cited — but Wikipedia-hosted files are resolvable now, and
 * throwing the name away here was what hid them.
 *
 * @param {string | null} src
 * @returns {string}
 */
function commonsFileFromThumb(src) {
  const u = String(src || "");
  const m =
    /\/wikipedia\/(?:commons|[a-z-]{2,12})\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(u);
  if (!m) return "";
  let name;
  try {
    name = decodeURIComponent(m[1]);
  } catch {
    name = m[1];
  }
  name = cleanText(name.replace(/_/g, " "), 160);
  return /\.(jpe?g|png|gif|webp|svg)$/i.test(name) ? name : "";
}

/**
 * The currency facts from one article, or `null` without an infobox.
 *
 * @param {string} title
 * @returns {Promise<CurrencyInfo | null>}
 */
async function readArticle(title) {
  const box = await fetchInfobox(title);
  if (!box || !box.rows.length) return null;
  // The article's own illustration is usually a composite of current notes and
  // coins — the single most useful image on the page.
  const img = box.table.querySelector("img");
  return {
    title: box.title,
    url: box.url,
    rows: box.rows.map((r) => ({ ...r, safe: SAFE_LABELS.includes(r.key) })),
    leadImage: commonsFileFromThumb(img ? img.getAttribute("src") : ""),
    leadCandidates: [],
    leadImageVia: "",
  };
}

/**
 * The first candidate article that actually carries a currency infobox.
 *
 * @param {Currency} currency
 * @returns {Promise<CurrencyInfo | null>}
 */
export async function loadCurrencyInfo(currency) {
  for (const title of await findCurrencyArticles(currency)) {
    let got;
    try {
      got = await readArticle(title);
    } catch {
      continue;
    }
    if (!got) continue;

    /*
      The infobox image is what was asked for. The page-image API picks the
      article's highest-scoring image, which for Bhutan is an Indian banknote
      the article mentions — right by its own rules, wrong for this. So the
      markup leads and the API backs it up, and both names stay as candidates
      because either can be stale.
    */
    const fromMarkup = got.leadImage || "";
    const fromApi = await pageImageName(got.title);
    got.leadCandidates = [...new Set([fromMarkup, fromApi].filter(Boolean))];
    got.leadImage = got.leadCandidates[0] || "";
    got.leadImageVia = fromMarkup ? "infobox markup" : fromApi ? "page image API" : "";
    return got;
  }
  return null;
}

/**
 * Count denominations without repeating them: the lists are formatted with
 * the symbol, so "KM 10, KM 20" would name the currency. A count is a clue.
 *
 * @param {CurrencyInfo | null} info
 * @param {RegExp} keyMatch
 * @returns {number}
 */
function countDenominations(info, keyMatch) {
  if (!info) return 0;
  const row = info.rows.find((r) => keyMatch.test(r.key));
  if (!row) return 0;
  return row.value
    .split(/[,;·]/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

/*
  The infobox files the subdivision's name under a label that is the ratio
  itself — Bosnia's row reads "1⁄100: Fening" — so that is what to look for,
  rather than a field called "subunit", which holds the decimal instead.
*/
const RATIO_LABEL = /^1\s*[⁄/]\s*[\d\s,.]+$/;

/**
 * @param {CurrencyInfo | null} info
 * @returns {Array<{ratio: string, name: string}>}
 */
export function subdivisionNames(info) {
  if (!info) return [];
  const out = [];
  for (const r of info.rows) {
    if (!RATIO_LABEL.test(r.label)) continue;
    // Strip any trailing gloss the article adds after the name.
    const name = r.value.split(" · ")[0].trim();
    if (name) out.push({ ratio: r.label, name: cleanText(name, 60) });
  }
  return out;
}

/**
 * Which facts the sheet may carry. The three switches each name the currency
 * on their own, so each is opt-in and each raises the reveal indicator.
 *
 * @param {{baseUnit?: boolean, symbol?: boolean, subdivision?: boolean}} opts
 * @param {Currency | null} currency
 * @param {CurrencyInfo | null} info
 * @returns {FactRow[]}
 */
export function factRows(opts, currency, info) {
  const o = opts || {};
  /** @type {FactRow[]} */
  const out = [];
  if (currency) {
    const d = currency.digits;
    out.push({
      label: "Subunit",
      value: d > 0 ? `1/${Math.pow(10, d)} of the main unit` : "none",
    });
  }
  if (info) {
    for (const r of info.rows) if (r.safe) out.push({ label: r.label, value: r.value });
    const notes = countDenominations(info, /freq|banknote/);
    const coins = countDenominations(info, /coin/);
    if (notes) out.push({ label: "Banknote denominations", value: String(notes) });
    if (coins) out.push({ label: "Coin denominations", value: String(coins) });
  }

  if (o.baseUnit && currency && currency.name)
    out.push({ label: "Base unit", value: currency.name, reveal: true });
  if (o.symbol && currency && currency.symbol)
    out.push({ label: "Symbol", value: currency.symbol, reveal: true });
  if (o.subdivision) {
    for (const s of subdivisionNames(info))
      out.push({ label: `Subdivision (${s.ratio})`, value: s.name, reveal: true });
  }

  const seen = new Set();
  return out.filter((r) => {
    const k = r.label.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Everything the app knows, for the facts panel — including what the sheet
 * omits, marked `withheld`.
 *
 * @param {object} sheetOpts the current sheet options
 * @param {Currency | null} currency
 * @param {CurrencyInfo | null} info
 * @returns {FactRow[]}
 */
export function allFactRows(sheetOpts, currency, info) {
  const onSheet = new Set(factRows(sheetOpts, currency, info).map((r) => r.label.toLowerCase()));
  const out = factRows({ symbol: true, baseUnit: true, subdivision: true }, currency, info);
  for (const r of out) r.withheld = !onSheet.has(r.label.toLowerCase());
  if (currency && currency.code)
    out.push({ label: "ISO 4217", value: currency.code, withheld: true });
  if (info)
    for (const r of info.rows)
      if (!r.safe) {
        const k = r.label.toLowerCase();
        if (out.some((x) => x.label.toLowerCase() === k)) continue;
        out.push({ label: r.label, value: r.value, withheld: true });
      }
  return out;
}

/**
 * A file hosted on the English Wikipedia rather than Commons.
 *
 * Such a file is usually there because it is non-free — that is the main
 * reason Commons rejects a file. It can still be fetched, but the licence has
 * to be shown loudly rather than buried, so using it is a deliberate choice.
 *
 * @param {string} name
 * @param {string[]} [why] collects the reason when the file can't be used
 * @returns {Promise<Piece | null>}
 */
async function wikipediaFileInfo(name, why) {
  /** @param {string} m */
  const say = (m) => {
    if (why) why.push(m);
    return null;
  };
  let data;
  try {
    data = await wikipedia({
      action: "query",
      prop: "imageinfo",
      titles: "File:" + name,
      iiprop: "url|extmetadata|mime",
      iiurlwidth: String(FULL_W),
      redirects: "1",
    });
  } catch (e) {
    return say("Wikipedia returned " + cleanText(e && e.message, 30));
  }

  const page = ((data && data.query && data.query.pages) || [])[0];
  if (!page) return say("Wikipedia returned no page");
  const item = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
  // A file hosted on Commons is flagged "missing" locally yet still carries
  // imageinfo, so the presence of imageinfo is what decides, not the flag.
  if (!item) return say(page.missing ? "no such file on Wikipedia" : "Wikipedia gave no file info");
  if (typeof item.mime === "string" && !/^image\//.test(item.mime))
    return say("not an image (" + cleanText(item.mime, 20) + ")");

  const url = firstSafeImageUrl(item.thumburl, item.url, item.descriptionurl);
  if (!url)
    return say(
      "URL not on the upload host (" +
        cleanText(describeRejectedUrl(item.thumburl, item.url), 60) +
        ")",
    );
  const ex = item.extmetadata || {};
  /** @param {string} k */
  const val = (k) => {
    const f = own(ex, k);
    return f && typeof f.value === "string" ? f.value : "";
  };
  const licence = classifyLicence(htmlToText(val("LicenseShortName"), 40), val("LicenseUrl"));
  const nonFree = /non-?free|fair use/i.test(licence.label) || licence.id === "unknown";

  return {
    title: cleanText(name, 160),
    pageid: Number.isInteger(page.pageid) ? page.pageid : null,
    thumb: url,
    full: url,
    author: htmlToText(val("Artist"), 70),
    licence,
    nonFree,
    local: true,
    section: "article",
    describeUrl:
      "https://en.wikipedia.org/wiki/File:" + encodeURIComponent(String(name).replace(/ /g, "_")),
    year: yearInTitle(name),
  };
}

/**
 * Last resort: ask the article which files it actually uses, so a name can be
 * matched case-insensitively. This survives the name in the page properties
 * disagreeing with the real title over case or spacing.
 *
 * @param {string} articleTitle
 * @returns {Promise<string[]>}
 */
async function articleFileTitles(articleTitle) {
  try {
    const data = await wikipedia({
      action: "query",
      prop: "images",
      titles: articleTitle,
      imlimit: "500",
      redirects: "1",
    });
    const page = ((data && data.query && data.query.pages) || [])[0];
    const rows = (page && page.images) || [];
    return rows
      .map((/** @type {any} */ r) => (typeof r.title === "string" ? r.title : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** @param {string} n */
const looseKey = (n) =>
  String(n)
    .toLowerCase()
    .replace(/^file:/, "")
    .replace(/[\s_]+/g, "");

/**
 * @typedef {object} Illustration
 * @property {Piece | null} onCommons the illustration, found on Commons; it
 *   belongs at the front of the picker
 * @property {Piece | null} onWikipedia the illustration (or a stand-in), found
 *   only on Wikipedia; it gets its own switch
 * @property {string} note what happened, for the facts panel
 */

/**
 * Find the article's illustration, which is usually the clearest view of the
 * money currently in use. Three places are tried in turn:
 *
 * 1. Commons, under each name the illustration may go by;
 * 2. Wikipedia's own file store, under the same names;
 * 3. the files the article actually uses, matched loosely by name — or,
 *    failing that, the most banknote-like of them.
 *
 * @param {CurrencyInfo | null} info
 * @returns {Promise<Illustration>}
 */
export async function findIllustration(info) {
  const leadNames = (info && info.leadCandidates) || [];
  if (!info || !leadNames.length) {
    return {
      onCommons: null,
      onWikipedia: null,
      note: info ? "This article has no illustration the app could resolve." : "",
    };
  }

  /** @type {string[]} */
  const why = [];

  // 1. Commons, under each candidate name.
  for (const name of leadNames) {
    try {
      const [lead] = await fileInfo(["File:" + name], "notes");
      if (lead) {
        lead.fromArticle = true;
        return { onCommons: lead, onWikipedia: null, note: "" };
      }
      why.push("not on Commons");
    } catch {
      why.push("Commons lookup failed");
    }
  }

  // 2. Wikipedia's own file store, under each candidate name.
  /** @type {Piece | null} */
  let found = null;
  for (const name of leadNames) {
    found = await wikipediaFileInfo(name, why);
    if (found) break;
  }

  // 3. Whatever files the article actually uses, matched loosely.
  if (!found && info.title) {
    const wanted = new Set(leadNames.map(looseKey));
    const titles = await articleFileTitles(info.title);
    const hit = titles.find((t) => wanted.has(looseKey(t)));
    if (hit) {
      found = await wikipediaFileInfo(hit.replace(/^File:/, ""), why);
    } else if (titles.length) {
      why.push(`none of the article's ${titles.length} files matched by name`);
      // Take a banknote-looking file from the article rather than nothing.
      const likely = titles.find(
        (t) =>
          /\b(banknote|bank note|note|bill|currency|money|coin)s?\b/i.test(t) &&
          !/\b(logo|icon|flag|seal|map|symbol)\b/i.test(t),
      );
      if (likely) {
        found = await wikipediaFileInfo(likely.replace(/^File:/, ""), why);
        if (found) found.guessedFromArticle = true;
      }
    }
  }

  const note = found
    ? (found.guessedFromArticle
        ? "Used another image from the article, since the named illustration couldn't be resolved. "
        : "The article's illustration is hosted on Wikipedia rather than Commons. ") +
      `Licence: ${found.licence.label}. Its own switch adds it to the sheet.`
    : `Couldn't resolve the article's illustration. Tried: ${why.join("; ")}.`;
  return { onCommons: null, onWikipedia: found, note };
}
