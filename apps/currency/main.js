/* ═══════════════════════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════════════════════ */

const COMMONS_API   = "https://commons.wikimedia.org/w/api.php";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const CDN           = "https://cdn.jsdelivr.net/npm";
const CLDR_VERSION  = "47";
const URL_TERRITORIES = `${CDN}/cldr-localenames-full@${CLDR_VERSION}/main/en/territories.json`;
const URL_CURRENCY_DATA = `${CDN}/cldr-core@${CLDR_VERSION}/supplemental/currencyData.json`;
const URL_CURRENCY_NAMES = `${CDN}/cldr-numbers-full@${CLDR_VERSION}/main/en/currencies.json`;

const UPLOAD_HOST  = "upload.wikimedia.org";
const MAX_FILES    = 120;
const MAX_SELECTED = 12;
const THUMB_W      = 400;
const FULL_W       = 1200;
const MAX_PIXELS   = 32e6;

const NOT_A_COUNTRY = new Set(["EU","EZ","UN","QO","XA","XB","ZZ"]);

/*
  Infobox rows safe to show without naming the currency. Everything else —
  code, symbol, subunit name, central bank, users, denomination lists, which
  carry the symbol — is the answer, and waits behind the reveal.
*/
const SAFE_LABELS = ["date of introduction", "inflation"];

/* The article band has no heading of its own; the image speaks for itself. */
const SECTION_LABEL = {notes: "Banknotes", coins: "Coins"};
const SECTION_ORDER = ["notes", "coins"];

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const own = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const HEX6 = /^#?([0-9a-f]{6})$/i;
const safeColour = (v, fb) => { const m = HEX6.exec(String(v||"")); return m ? "#"+m[1].toLowerCase() : fb; };

function parseHex(raw){
  const t = String(raw || "").trim().replace(/^#/, "");
  if(/^[0-9a-f]{3}$/i.test(t)) return "#" + t.toLowerCase().split("").map(c => c + c).join("");
  if(/^[0-9a-f]{6}$/i.test(t)) return "#" + t.toLowerCase();
  return null;
}

const BIDI_AND_CONTROL = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g;
function cleanText(raw, max){
  return String(raw || "").replace(BIDI_AND_CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max || 120);
}

const norm = s => String(s).toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
const bareName = n => norm(String(n).replace(/^the\s+/i, ""));

const MARK = "\u001f";
const BLOCKISH = new Set(["DIV","P","LI","TR","UL","OL","DD","DT","SECTION",
                          "TABLE","TBODY","HR","H1","H2","H3","H4","H5","H6"]);
const REF_MARK = /\[\s*(\d+|citation needed|clarification needed|note \d+)\s*\]/gi;

/*
  textContent runs adjacent elements together, so stacked infobox values arrive
  as one unreadable string. Walk the node instead, marking block boundaries.
  The marker is a control character, because a middle dot is real data.
*/
function richText(node){
  let out = "";
  const kids = node && node.childNodes ? Array.from(node.childNodes) : [];
  for(const child of kids){
    if(child.nodeType === 3){ out += child.nodeValue || ""; continue; }
    if(child.nodeType !== 1) continue;
    const tag = String(child.tagName || "").toUpperCase();
    if(tag === "BR"){ out += MARK; continue; }
    const inner = richText(child);
    if(!inner.trim()) continue;
    if(BLOCKISH.has(tag)) out += MARK + inner + MARK;
    else {
      if(out && !/\s$/.test(out) && !/^\s/.test(inner)) out += " ";
      out += inner;
    }
  }
  return out;
}

function tidy(raw, max){
  let t = String(raw || "").replace(REF_MARK, " ");
  t = t.replace(/[\s\u001f]*\u001f[\s\u001f]*/g, MARK);
  t = t.replace(/^\u001f+|\u001f+$/g, "");
  t = t.replace(/\u001f/g, " · ");
  return cleanText(t, max);
}

/* Commons metadata is free text containing HTML; keep only the text. */
function htmlToText(raw, max){
  const s = String(raw || "");
  if(!s) return "";
  try {
    const doc = new DOMParser().parseFromString(s, "text/html");
    if(doc.querySelectorAll) doc.querySelectorAll("script,style").forEach(n => n.remove());
    return cleanText(doc.body ? doc.body.textContent : s, max || 80);
  } catch (e) {
    return cleanText(s.replace(/<[^>]*>/g, " "), max || 80);
  }
}

/* ═══════════════════════════════════════════════════════════
   APIs
   ═══════════════════════════════════════════════════════════ */

async function getJson(url){
  const r = await fetch(url);
  if(!r.ok){ const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
  return r.json();
}

async function mediawiki(endpoint, params){
  const p = new URLSearchParams({format: "json", formatversion: "2", origin: "*", ...params});
  const data = await getJson(endpoint + "?" + p.toString());
  if(data && data.error) throw new Error(String(data.error.code || "api error").slice(0, 60));
  return data;
}
const commons = p => mediawiki(COMMONS_API, p);
const wikipedia = p => mediawiki(WIKIPEDIA_API, p);

/* ═══════════════════════════════════════════════════════════
   CLDR: countries, and which currency each one uses
   ═══════════════════════════════════════════════════════════ */

let COUNTRIES = [], CURRENCY_REGION = null, CURRENCY_FRACTIONS = null, CURRENCY_NAMES = {};

async function loadReference(){
  const [terr, cur, names] = await Promise.all([
    getJson(URL_TERRITORIES), getJson(URL_CURRENCY_DATA), getJson(URL_CURRENCY_NAMES)
  ]);

  const t = terr && terr.main && terr.main.en && terr.main.en.localeDisplayNames
            && terr.main.en.localeDisplayNames.territories;
  if(!t) throw new Error("unexpected territories data");

  const byCode = new Map();
  for(const key of Object.keys(t)){
    const value = own(t, key);
    if(typeof value !== "string") continue;
    const code = key.split("-")[0];
    if(!/^[A-Z]{2}$/.test(code) || NOT_A_COUNTRY.has(code)) continue;
    const entry = byCode.get(code) || {code, name: "", aliases: []};
    if(key === code) entry.name = cleanText(value, 80);
    else entry.aliases.push(cleanText(value, 80));
    byCode.set(code, entry);
  }
  COUNTRIES = [...byCode.values()].filter(e => e.name)
    .sort((a,b) => bareName(a.name).localeCompare(bareName(b.name)));

  const cd = cur && cur.supplemental && cur.supplemental.currencyData;
  if(!cd || !cd.region) throw new Error("unexpected currency data");
  CURRENCY_REGION = cd.region;
  CURRENCY_FRACTIONS = cd.fractions || {};

  CURRENCY_NAMES = (names.main && names.main.en && names.main.en.numbers
                    && names.main.en.numbers.currencies) || {};
  if(!COUNTRIES.length) throw new Error("no countries returned");
}

/* The currency in current use, per CLDR's tender history. */
function currencyFor(code){
  const history = own(CURRENCY_REGION, code);
  if(!Array.isArray(history)) return null;
  let found = null;
  for(const entry of history){
    for(const cur of Object.keys(entry)){
      const meta = own(entry, cur);
      if(!meta || meta._to) continue;                 // superseded
      if(meta._tender === "false") continue;          // not legal tender
      found = cur;
    }
  }
  if(!found) return null;
  const rec = own(CURRENCY_NAMES, found) || {};
  const frac = own(CURRENCY_FRACTIONS, found) || own(CURRENCY_FRACTIONS, "DEFAULT") || {};
  const digits = parseInt(frac._digits, 10);
  return {
    code: found,
    name: cleanText(rec.displayName || found, 60),
    plural: cleanText(rec["displayName-count-other"] || "", 60),
    symbol: cleanText(rec.symbol || "", 12),
    digits: Number.isFinite(digits) ? digits : 2
  };
}

/* ═══════════════════════════════════════════════════════════
   Commons images
   ═══════════════════════════════════════════════════════════ */

/*
  A protocol-relative "//upload.wikimedia.org/..." has no scheme, so parsing it
  without a base throws and looks like a wrong host. Give it one.
*/
function safeImageUrl(u){
  const raw = String(u || "");
  if(!raw) return null;
  try {
    const url = new URL(raw, "https://" + UPLOAD_HOST + "/");
    if(url.protocol !== "https:" || url.hostname !== UPLOAD_HOST) return null;
    return url.href;
  } catch (e) { return null; }
}

/* The first usable URL among several, so a bad thumbnail can't mask a good original. */
function firstSafeImageUrl(...candidates){
  for(const c of candidates){ const ok = safeImageUrl(c); if(ok) return ok; }
  return null;
}

/* What was rejected, for a message worth reading. */
function describeRejectedUrl(...candidates){
  const seen = candidates.filter(Boolean).map(c => {
    try { return new URL(String(c), "https://" + UPLOAD_HOST + "/").host; }
    catch (e) { return "unparseable"; }
  });
  return seen.length ? seen.join(", ") : "no URL at all";
}

function widenThumb(thumburl, naturalWidth){
  const m = /\/(\d+)px-([^/]+)$/.exec(thumburl);
  if(!m) return null;
  const have = parseInt(m[1], 10);
  const cap = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : FULL_W;
  const target = Math.min(FULL_W, cap);
  if(!Number.isFinite(target) || target <= have) return null;
  return safeImageUrl(thumburl.replace(/\/\d+px-([^/]+)$/, `/${Math.round(target)}px-$1`));
}

/*
  Anything unrecognised is treated as the strictest case, so an unparsed
  licence can never slip into an export looking freer than it is.
*/
function classifyLicence(short, urlRaw){
  const s = (short || "").toLowerCase();
  const u = String(urlRaw || "").toLowerCase();
  const label = short || "Licence not stated";
  if(/publicdomain\/zero|\/cc0\//.test(u) || /\bcc0\b|public domain|pd-|no restrictions/.test(s))
    return {id: "pd", label, attribution: false, shareAlike: false};
  if(/\/by-sa\//.test(u) || /by-sa|share.?alike|gfdl/.test(s))
    return {id: "sa", label, attribution: true, shareAlike: true};
  if(/\/by\//.test(u) || /^cc by\b|attribution/.test(s))
    return {id: "by", label, attribution: true, shareAlike: false};
  return {id: "unknown", label, attribution: true, shareAlike: true};
}

/*
  A year in the file name is the quickest signal that a note is historic rather
  than current. It is a hint, not a fact — the file page is what settles it.
*/
function yearInTitle(title){
  const years = String(title).match(/\b(1[5-9]\d{2}|20[0-4]\d)\b/g);
  if(!years) return "";
  // Several years usually means a series range; show the earliest.
  return years.map(Number).sort((a,b) => a - b)[0].toString();
}

function describeFile(page, info, section){
  if(typeof info.mime === "string" && !/^image\//.test(info.mime)) return null;
  const thumb = firstSafeImageUrl(info.thumburl, info.url);
  if(!thumb) return null;
  const pageid = Number.isInteger(page.pageid) && page.pageid > 0 ? page.pageid : null;
  if(!pageid) return null;                    // a plate we cannot cite is unusable

  const ex = info.extmetadata || {};
  const val = k => { const f = own(ex, k); return f && typeof f.value === "string" ? f.value : ""; };

  return {
    title: cleanText(String(page.title || "").replace(/^File:/, ""), 140),
    pageid, thumb,
    full: widenThumb(thumb, info.width) || thumb,
    author: htmlToText(val("Artist"), 70),
    licence: classifyLicence(htmlToText(val("LicenseShortName"), 40), val("LicenseUrl")),
    describeUrl: `https://commons.wikimedia.org/w/index.php?curid=${pageid}`,
    year: yearInTitle(String(page.title || "")),
    section
  };
}

async function filesIn(title, limit){
  const data = await commons({
    action: "query", list: "categorymembers", cmtitle: title,
    cmtype: "file", cmlimit: String(limit || 200)
  });
  const rows = (data && data.query && data.query.categorymembers) || [];
  return rows.map(r => typeof r.title === "string" ? r.title : "").filter(Boolean);
}

async function fileInfo(titles, section){
  const out = [];
  for(let i = 0; i < titles.length; i += 50){
    const data = await commons({
      action: "query", prop: "imageinfo", titles: titles.slice(i, i + 50).join("|"),
      iiprop: "url|extmetadata|size|mime", iiurlwidth: String(THUMB_W),
      redirects: "1"            // a renamed file leaves its old name behind
    });
    for(const page of (data && data.query && data.query.pages) || []){
      const info = page && Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      if(!info) continue;
      const rec = describeFile(page, info, section);
      if(rec) out.push(rec);
    }
  }
  return out;
}

/*
  Category naming varies: a euro country's own category holds mostly historical
  money, while the current notes sit under the currency's name. Try both.
*/
function categoryCandidates(country, currency){
  const c = country.name;
  const bare = c.replace(/^the\s+/i, "");
  /*
    Commons is inconsistent about the definite article — "Banknotes of Germany"
    but "Banknotes of the United States" — and CLDR's name carries no "the".
    Trying both costs one wasted request; trying one costs the whole country.
  */
  const forms = [...new Set([c, bare, `the ${bare}`])];

  const notes = forms.map(f => `Category:Banknotes of ${f}`);
  const coins = forms.map(f => `Category:Coins of ${f}`);

  if(currency && currency.name){
    const cur = currency.name;
    notes.unshift(`Category:${cur} banknotes`);
    coins.unshift(`Category:${cur} coins`);
    // Only the euro files its coins by issuing country, because only the euro
    // has country-specific national sides.
    if(currency.code === "EUR") coins.unshift(`Category:Euro coins of ${bare}`);
  }
  return {notes: [...new Set(notes)], coins: [...new Set(coins)]};
}

/* ═══════════════════════════════════════════════════════════
   Wikipedia: the currency infobox
   ═══════════════════════════════════════════════════════════ */

const TITLE_OK = /^[^\n\r|#<>[\]{}]{2,120}$/;

/*
  CLDR title-cases currency names — "Thai Baht", "US Dollar" — while articles
  use sentence case and sometimes a different name entirely. Generate the
  plausible spellings rather than betting on one.
*/
function articleCandidates(currency){
  // "US Dollar" becomes "US dollar", but "United States Dollar" has to become
  // "United States dollar" — so lowercase the last word as well as all of them.
  const lastLower = t => t.replace(/\s(\S+)$/, (m, w) => " " + w.toLowerCase());
  const allLower  = t => t.replace(/\s+\S/g, m => m.toLowerCase());

  const seeds = [];
  for(const seed of [currency.name, currency.plural].filter(Boolean)){
    seeds.push(seed);
    if(/^US\b/.test(seed)) seeds.push(seed.replace(/^US\b/, "United States"));
  }
  const out = [];
  for(const seed of seeds) out.push(seed, lastLower(seed), allLower(seed));
  return [...new Set(out)].filter(t => TITLE_OK.test(t)).slice(0, 10);
}

/* Existing titles first, then search results, in the order worth trying. */
async function findCurrencyArticles(currency){
  const ordered = [];
  const cands = articleCandidates(currency);
  if(cands.length){
    const data = await wikipedia({action: "query", titles: cands.join("|"), redirects: "1"});
    const pages = (data && data.query && data.query.pages) || [];
    const live = pages.filter(pg => pg && !pg.missing && typeof pg.title === "string");
    for(const c of cands){
      const hit = live.find(pg => pg.title === c);
      if(hit && !ordered.includes(hit.title)) ordered.push(hit.title);
    }
    for(const pg of live) if(!ordered.includes(pg.title)) ordered.push(pg.title);
  }
  try {
    const found = await wikipedia({
      action: "query", list: "search", srnamespace: "0", srlimit: "5",
      srsearch: `${currency.name} currency`
    });
    for(const r of (found && found.query && found.query.search) || [])
      if(typeof r.title === "string" && !ordered.includes(r.title)) ordered.push(r.title);
  } catch (e) { /* the title lookup may already have been enough */ }
  return ordered.slice(0, 8);
}

/*
  MediaWiki has an API for exactly this — the image chosen to represent a page,
  which for a currency article is the infobox illustration. Scraping the
  rendered HTML is the fallback, because markup changes and an API contract
  doesn't.
*/
async function pageImageName(title){
  try {
    const data = await wikipedia({
      action: "query", prop: "pageimages", piprop: "name",
      // The default is "free", which returns nothing at all for a non-free
      // illustration — the licence is reported later rather than filtered here.
      pilicense: "any",
      titles: title, redirects: "1"
    });
    const pages = (data && data.query && data.query.pages) || [];
    const name = pages.length && typeof pages[0].pageimage === "string" ? pages[0].pageimage : "";
    if(!name) return "";
    let out = String(name);
    // The API returns raw names, but decode defensively in case one arrives escaped.
    if(/%[0-9a-f]{2}/i.test(out)){ try { out = decodeURIComponent(out); } catch (e) { /* keep as-is */ } }
    return cleanText(out.replace(/_/g, " "), 160);
  } catch (e) { return ""; }
}

/* The first candidate that actually carries a currency infobox. */
async function loadCurrencyInfo(currency){
  for(const title of await findCurrencyArticles(currency)){
    let got = null;
    try { got = await fetchInfobox(title); }
    catch (e) { continue; }
    if(!got) continue;

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
    got.leadImageVia = fromMarkup ? "infobox markup" : (fromApi ? "page image API" : "");
    return got;
  }
  return null;
}

/*
  Recover the file name from a rendered thumbnail path, whichever wiki hosts
  it. An earlier version discarded /wikipedia/en/ paths because only Commons
  files could be cited — but Wikipedia-hosted files are resolvable now, and
  throwing the name away here was what hid them.
*/
function commonsFileFromThumb(src){
  const u = String(src || "");
  const m = /\/wikipedia\/(?:commons|[a-z-]{2,12})\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(u);
  if(!m) return "";
  let name;
  try { name = decodeURIComponent(m[1]); } catch (e) { name = m[1]; }
  name = cleanText(name.replace(/_/g, " "), 160);
  return /\.(jpe?g|png|gif|webp|svg)$/i.test(name) ? name : "";
}

async function fetchInfobox(title){
  const data = await wikipedia({
    action: "parse", page: title, prop: "text", section: "0",
    redirects: "1", disablelimitreport: "1"
  });
  const html = data && data.parse && typeof data.parse.text === "string" ? data.parse.text : "";
  if(!html) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  if(doc.querySelectorAll) doc.querySelectorAll("script,style,sup.reference").forEach(n => n.remove());
  const table = doc.querySelector("table.infobox");
  if(!table) return null;

  // The article's own illustration is usually a composite of current notes and
  // coins — the single most useful image on the page.
  const leadImage = commonsFileFromThumb(
    table.querySelector("img") ? table.querySelector("img").getAttribute("src") : "");

  const rows = [];
  const seen = new Set();
  for(const tr of table.querySelectorAll("tr")){
    const th = tr.querySelector("th");
    const td = tr.querySelector("td");
    if(!th || !td) continue;
    const label = tidy(richText(th) || th.textContent, 42);
    const value = tidy(richText(td) || td.textContent, 160);
    if(!label || !value) continue;
    const key = label.toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key);
    rows.push({label, value, key, safe: SAFE_LABELS.includes(key)});
  }
  if(!rows.length) return null;
  const finalTitle = cleanText(data.parse.title || title, 120);
  return {
    title: finalTitle,
    url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(finalTitle.replace(/ /g, "_")),
    rows, leadImage
  };
}

/*
  Count denominations without repeating them: the lists are formatted with the
  symbol, so "KM 10, KM 20" would name the currency. A count is a clue.
*/
function countDenominations(info, keyMatch){
  if(!info) return 0;
  const row = info.rows.find(r => keyMatch.test(r.key));
  if(!row) return 0;
  return row.value.split(/[,;·]/).map(s => s.trim()).filter(Boolean).length;
}

/*
  The infobox files the subdivision's name under a label that is the ratio
  itself — Bosnia's row reads "1⁄100: Fening" — so that is what to look for,
  rather than a field called "subunit", which holds the decimal instead.
*/
const RATIO_LABEL = /^1\s*[⁄\/]\s*[\d\s,.]+$/;

function subdivisionNames(){
  if(!info) return [];
  const out = [];
  for(const r of info.rows){
    if(!RATIO_LABEL.test(r.label)) continue;
    // Strip any trailing gloss the article adds after the name.
    const name = r.value.split(" · ")[0].trim();
    if(name) out.push({ratio: r.label, name: cleanText(name, 60)});
  }
  return out;
}

/*
  Which rows the sheet may carry. The three additions each name the currency
  on their own, so each is opt-in and each raises the reveal indicator.
*/
function factRows(opts){
  const o = opts || {};
  const out = [];
  if(currency){
    const d = currency.digits;
    out.push({label: "Subunit", value: d > 0 ? `1/${Math.pow(10, d)} of the main unit` : "none"});
  }
  if(info){
    for(const r of info.rows) if(r.safe) out.push({label: r.label, value: r.value});
    const notes = countDenominations(info, /freq|banknote/);
    const coins = countDenominations(info, /coin/);
    if(notes) out.push({label: "Banknote denominations", value: String(notes)});
    if(coins) out.push({label: "Coin denominations", value: String(coins)});
  }

  if(o.baseUnit && currency && currency.name)
    out.push({label: "Base unit", value: currency.name, reveal: true});
  if(o.symbol && currency && currency.symbol)
    out.push({label: "Symbol", value: currency.symbol, reveal: true});
  if(o.subdivision){
    const subs = subdivisionNames();
    for(const s of subs) out.push({label: `Subdivision (${s.ratio})`, value: s.name, reveal: true});
  }

  const seen = new Set();
  return out.filter(r => {
    const k = r.label.toLowerCase();
    if(seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* Everything the app knows, for the panel — including what the sheet omits. */
function allFactRows(){
  const onSheet = new Set(factRows(currentOptions()).map(r => r.label.toLowerCase()));
  const out = factRows({symbol: true, baseUnit: true, subdivision: true});
  for(const r of out) r.withheld = !onSheet.has(r.label.toLowerCase());
  if(currency && currency.code)
    out.push({label: "ISO 4217", value: currency.code, withheld: true});
  if(info) for(const r of info.rows) if(!r.safe){
    const k = r.label.toLowerCase();
    if(out.some(x => x.label.toLowerCase() === k)) continue;
    out.push({label: r.label, value: r.value, withheld: true});
  }
  return out;
}

/*
  A file hosted on the English Wikipedia rather than Commons is usually there
  because it is non-free — that is the main reason Commons rejects a file. It
  can still be fetched, but the licence has to be shown loudly rather than
  buried, so the choice to use it is a deliberate one.
*/
async function wikipediaFileInfo(name, why){
  const say = m => { if(why) why.push(m); return null; };
  let data;
  try {
    data = await wikipedia({
      action: "query", prop: "imageinfo", titles: "File:" + name,
      iiprop: "url|extmetadata|mime", iiurlwidth: String(FULL_W), redirects: "1"
    });
  } catch (e) { return say("Wikipedia returned " + cleanText(e && e.message, 30)); }

  const page = ((data && data.query && data.query.pages) || [])[0];
  if(!page) return say("Wikipedia returned no page");
  const item = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
  // A file hosted on Commons is flagged "missing" locally yet still carries
  // imageinfo, so the presence of imageinfo is what decides, not the flag.
  if(!item) return say(page.missing ? "no such file on Wikipedia" : "Wikipedia gave no file info");
  if(typeof item.mime === "string" && !/^image\//.test(item.mime))
    return say("not an image (" + cleanText(item.mime, 20) + ")");

  const url = firstSafeImageUrl(item.thumburl, item.url, item.descriptionurl);
  if(!url) return say("URL not on the upload host (" +
                      cleanText(describeRejectedUrl(item.thumburl, item.url), 60) + ")");
  const ex = item.extmetadata || {};
  const val = k => { const f = own(ex, k); return f && typeof f.value === "string" ? f.value : ""; };
  const licence = classifyLicence(htmlToText(val("LicenseShortName"), 40), val("LicenseUrl"));
  const nonFree = /non-?free|fair use/i.test(licence.label) || licence.id === "unknown";

  return {
    title: cleanText(name, 160),
    pageid: Number.isInteger(page.pageid) ? page.pageid : null,
    thumb: url, full: url,
    author: htmlToText(val("Artist"), 70),
    licence, nonFree, local: true,
    section: "article",
    describeUrl: "https://en.wikipedia.org/wiki/File:" +
                 encodeURIComponent(String(name).replace(/ /g, "_")),
    year: yearInTitle(name)
  };
}

/*
  Last resort: ask the article which files it actually uses and match a
  candidate name case-insensitively. This survives the name in the page
  properties disagreeing with the real title over case or spacing.
*/
async function articleFileTitles(articleTitle){
  try {
    const data = await wikipedia({
      action: "query", prop: "images", titles: articleTitle,
      imlimit: "500", redirects: "1"
    });
    const page = ((data && data.query && data.query.pages) || [])[0];
    const rows = (page && page.images) || [];
    return rows.map(r => typeof r.title === "string" ? r.title : "").filter(Boolean);
  } catch (e) { return []; }
}

const looseKey = n => String(n).toLowerCase().replace(/^file:/, "").replace(/[\s_]+/g, "");

/* ═══════════════════════════════════════════════════════════
   Image loading
   ═══════════════════════════════════════════════════════════ */

let CORS_MODE = "unknown", tainted = false;
const imageCache = new Map();

function rawLoad(url, anonymous){
  return new Promise((res, rej) => {
    const img = new Image();
    if(anonymous) img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("image failed"));
    img.src = url;
  });
}

async function loadImage(url){
  if(imageCache.has(url)) return imageCache.get(url);
  let img;
  if(CORS_MODE === "none") img = await rawLoad(url, false);
  else {
    try { img = await rawLoad(url, true); CORS_MODE = "anonymous"; }
    catch (e) {
      if(CORS_MODE === "anonymous") throw e;
      img = await rawLoad(url, false);
      CORS_MODE = "none"; tainted = true;
    }
  }
  imageCache.set(url, img);
  return img;
}

/* ═══════════════════════════════════════════════════════════
   Rendering a note or coin
   ═══════════════════════════════════════════════════════════ */

/*
  Many jurisdictions accept a banknote reproduction marked SPECIMEN. The word
  is drawn across the note with a contrasting outline so it reads on any
  design, at a strength you control.
*/
function renderPiece(img, rec, opts){
  const w = Math.max(1, img.naturalWidth || img.width);
  const h = Math.max(1, img.naturalHeight || img.height);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  const marksAllowed = rec.section === "notes" || rec.section === "article";
  if(!(opts.specimen && marksAllowed)) return c;

  const px = Math.max(10, Math.round(Math.min(w, h) * 0.26));
  ctx.save();
  ctx.translate(w/2, h/2);
  ctx.rotate(-Math.atan2(h, w));
  ctx.font = `600 ${px}px "Karla", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = clamp(opts.specimenAlpha, 0.05, 0.95);
  ctx.lineWidth = Math.max(2, px * 0.09);
  ctx.strokeStyle = "rgba(12,12,12,0.85)";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeText("SPECIMEN", 0, 0);
  ctx.fillText("SPECIMEN", 0, 0);
  ctx.restore();
  return c;
}

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

let chosen = null, currency = null, info = null;
let candidates = [], selected = [];
let busy = 0, leadNote = "";
let articleImageTouched = false;   // whether the reader has set it by hand
let articleImage = null;   // the article illustration, when it is not on Commons

function progress(label, pending){
  const bar = $("bar");
  if(label === null){ bar.style.display = "none"; bar.classList.remove("pending"); $("loadLabel").textContent = ""; return; }
  bar.style.display = "block";
  bar.classList.toggle("pending", !!pending);
  if(!pending) bar.firstElementChild.style.width = "100%";
  $("loadLabel").textContent = label;
}

function note(msg, isErr){
  const n = $("note");
  n.textContent = msg || "";
  n.className = "note" + (isErr ? " err" : "");
}

function frameSpec(){
  const v = $("frame").value;
  let W, H;
  if(v === "custom"){
    W = clamp(Math.round(+$("customW").value) || 0, 64, 8000);
    H = clamp(Math.round(+$("customH").value) || 0, 64, 8000);
  } else {
    const [a, b] = v.split("x");
    W = clamp(parseInt(a, 10) || 2400, 64, 8000);
    H = clamp(parseInt(b, 10) || 1600, 64, 8000);
  }
  if(W * H > MAX_PIXELS){
    const k = Math.sqrt(MAX_PIXELS / (W*H));
    W = Math.max(64, Math.round(W*k)); H = Math.max(64, Math.round(H*k));
  }
  return {W, H};
}

function currentOptions(){
  return {
    fg: safeColour($("fgColor").value, "#16201c"),
    bg: safeColour($("bgColor").value, "#f4f6f2"),
    at: safeColour($("atColor").value, "#65726b"),
    transparent: $("optTransparent").checked,
    sections: $("optSections").checked,
    facts: $("optFacts").checked,
    factsTop: $("factsTop").getAttribute("aria-pressed") === "true",
    symbol: $("optSymbol").checked,
    baseUnit: $("optBaseUnit").checked,
    subdivision: $("optSubdivision").checked,
    specimen: $("optSpecimen").checked,
    articleImage: $("optArticleImage").checked,
    specimenAlpha: clamp(+$("specimenAlpha").value, 10, 90) / 100,
    caption: cleanText($("capText").value, 120),
    capTop: $("capTop").getAttribute("aria-pressed") === "true"
  };
}

/* ═══════════════════════════════════════════════════════════
   Drawing
   ═══════════════════════════════════════════════════════════ */

async function drawSheet(canvas, opts){
  const {W, H} = frameSpec();
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  if(!opts.transparent){ ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, W, H); }

  const pad = Math.round(Math.min(W, H) * 0.055);
  let top = pad, bottom = H - pad;

  if(opts.caption){
    const capPx = Math.round(H * 0.045);
    ctx.font = `600 ${capPx}px "Spectral", Georgia, serif`;
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let px = capPx, t = opts.caption;
    while(px > 14 && ctx.measureText(t).width > W - pad*2){ px -= 2; ctx.font = `600 ${px}px "Spectral", Georgia, serif`; }
    if(opts.capTop){ ctx.fillText(t, W/2, top + px*0.6); top += px * 1.9; }
    else           { ctx.fillText(t, W/2, bottom - px*0.6); bottom -= px * 1.9; }
  }

  // Work out whether any images will be drawn before deciding how to set the
  // facts: alone on the sheet they deserve a proper layout, not a packed line.
  const groups = [];
  if(opts.articleImage && articleImage) groups.push({id: "article", items: [articleImage]});
  for(const id of SECTION_ORDER){
    const items = selected.filter(s => s.section === id);
    if(items.length) groups.push({id, items});
  }

  const rows = opts.facts ? factRows(opts) : [];
  if(rows.length && !groups.length){
    drawFactsPanel(ctx, rows, pad, top, W - pad*2, bottom - top, opts);
    return;
  }
  if(rows.length){
    const px = clamp(Math.round(H * 0.022), 11, 30);
    ctx.font = `400 ${px}px "Karla", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const lines = rows.map(r => `${r.label}: ${r.value}`);
    const packed = [];
    let cur = "";
    for(const line of lines){
      const test = cur ? cur + "   ·   " + line : line;
      if(cur && ctx.measureText(test).width > W - pad*2){ packed.push(cur); cur = line; }
      else cur = test;
    }
    if(cur) packed.push(cur);

    const blockH = packed.length * px * 1.45;
    let ly = opts.factsTop ? top + px * 0.9 : bottom - blockH + px * 0.9;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.88;
    for(const line of packed){ ctx.fillText(line, W/2, ly); ly += px * 1.45; }
    ctx.globalAlpha = 1;
    if(opts.factsTop) top += blockH + px * 0.6;
    else              bottom -= blockH + px * 0.6;
  }

  if(!groups.length) return;

  const prepared = new Map();
  for(const rec of groups.flatMap(g => g.items)){
    let img;
    try { img = await loadImage(rec.full); }
    catch (e) {
      try { img = await loadImage(rec.thumb); }
      catch (e2) { continue; }
    }
    prepared.set(rec, renderPiece(img, rec, opts));
  }

  const bandH = (bottom - top) / groups.length;
  for(let gi = 0; gi < groups.length; gi++){
    const g = groups[gi];
    const items = g.items.filter(r => prepared.has(r));
    if(!items.length) continue;
    const bandTop = top + gi * bandH;
    let y = bandTop;

    const heading = own(SECTION_LABEL, g.id) || "";
    if(opts.sections && heading){
      const hPx = clamp(Math.round(bandH * 0.13), 15, 44);
      ctx.font = `600 ${hPx}px "Karla", sans-serif`;
      ctx.fillStyle = opts.fg;
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = 0.78;
      ctx.fillText(heading, pad, y + hPx);
      ctx.globalAlpha = 1;
      y += hPx * 1.7;      // no heading means the band keeps the space
    }
    drawGrid(ctx, items, prepared, pad, y, W - pad*2, bandTop + bandH - y - bandH*0.05, opts);
  }
}

/*
  Facts with the sheet to themselves: a ruled two-column list, centred, with
  the type as large as the space allows. One column when there are few rows or
  the frame is tall, two when there are many and it is wide.
*/
function drawFactsPanel(ctx, rows, x, y, w, h, opts){
  if(!rows.length || w <= 20 || h <= 20) return;

  // Measure once at a reference size, then scale.
  const probe = 100;
  ctx.font = `500 ${probe}px "Karla", sans-serif`;
  let widestLabel = 0;
  for(const r of rows) widestLabel = Math.max(widestLabel, ctx.measureText(r.label).width);
  ctx.font = `400 ${probe}px "Karla", sans-serif`;
  let widestValue = 0;
  for(const r of rows) widestValue = Math.max(widestValue, ctx.measureText(r.value).width);

  const gapRatio = 0.6;
  const unit = (widestLabel + widestValue) / probe + gapRatio;

  // Rather than guess at one or two columns, try both and keep whichever
  // makes the type larger — the same rule the image grid uses.
  let best = null;
  for(const cols of (rows.length >= 4 ? [1, 2] : [1])){
    const perCol = Math.ceil(rows.length / cols);
    const colGap = w * 0.06;
    const colW = (w - colGap * (cols - 1)) / cols;
    if(colW <= 20) continue;
    const px = Math.min(colW / unit, h / (perCol * 1.9 + 0.6));
    if(!best || px > best.px) best = {cols, perCol, colGap, colW, px};
  }
  if(!best) return;

  const px = clamp(best.px, 12, Math.round(h * 0.13));
  const lineH = px * 1.9;
  const blockH = best.perCol * lineH;
  const gap = px * gapRatio;
  const labelW = widestLabel / probe * px;
  const startY = y + Math.max(0, (h - blockH) / 2) + lineH * 0.5;

  ctx.textBaseline = "middle";
  rows.forEach((r, i) => {
    const c = Math.floor(i / best.perCol), row = i % best.perCol;
    const colX = x + c * (best.colW + best.colGap);
    const ly = startY + row * lineH;

    // A hairline under each pair, which is what makes a list like this read.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = opts.fg;
    ctx.fillRect(colX, Math.round(ly + lineH * 0.42), best.colW, Math.max(1, Math.round(px * 0.03)));

    ctx.globalAlpha = 0.62;
    ctx.font = `500 ${px}px "Karla", sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(r.label, colX + labelW, ly);

    ctx.globalAlpha = r.reveal ? 1 : 0.92;
    ctx.font = `400 ${px}px "Karla", sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(r.value, colX + labelW + gap, ly);
  });
  ctx.globalAlpha = 1;
}

/* The column count that makes the smallest image as large as possible. */
function chooseGrid(items, prepared, w, h, gap, needsCredit){
  const K = items.length;
  let best = null;
  for(let cols = 1; cols <= K; cols++){
    const rows = Math.ceil(K / cols);
    const cellW = (w - gap * (cols - 1)) / cols;
    const cellH = (h - gap * (rows - 1)) / rows;
    if(cellW <= 4 || cellH <= 4) continue;
    const credPx = needsCredit ? clamp(Math.round(cellH * 0.13), 9, 20) : 0;
    const plateH = cellH - (credPx ? credPx * 2.0 : 0);
    if(plateH <= 4) continue;
    let worst = Infinity;
    for(const rec of items){
      const p = prepared.get(rec);
      if(!p || !p.width || !p.height) continue;
      worst = Math.min(worst, Math.min(cellW / p.width, plateH / p.height));
    }
    if(!Number.isFinite(worst)) continue;
    if(!best || worst > best.worst) best = {worst, cols, rows, cellW, cellH, credPx, plateH};
  }
  return best;
}

function drawGrid(ctx, items, prepared, x, y, w, h, opts){
  if(!items.length || h <= 10 || w <= 10) return;
  const needsCredit = items.some(r => r.licence.attribution);
  const gap = Math.max(6, Math.round(Math.min(w, h) * 0.03));
  const best = chooseGrid(items, prepared, w, h, gap, needsCredit);
  if(!best) return;

  const {cols, rows, cellW, cellH, credPx, plateH} = best;
  const gridH = rows * cellH + gap * (rows - 1);
  const yTop = y + Math.max(0, (h - gridH) / 2);

  items.forEach((rec, i) => {
    const piece = prepared.get(rec);
    if(!piece) return;
    const r = Math.floor(i / cols), c = i % cols;
    const inRow = Math.min(cols, items.length - r * cols);
    const rowW = inRow * cellW + gap * (inRow - 1);
    const cellX = x + (w - rowW) / 2 + c * (cellW + gap);
    const cellY = yTop + r * (cellH + gap);

    const scale = Math.min(cellW / piece.width, plateH / piece.height);
    const dw = Math.max(1, Math.round(piece.width * scale));
    const dh = Math.max(1, Math.round(piece.height * scale));
    ctx.drawImage(piece,
      Math.round(cellX + (cellW - dw) / 2),
      Math.round(cellY + (plateH - dh) / 2), dw, dh);

    if(credPx && rec.licence.attribution){
      // Attribution travels with the image, naming the author and a permalink
      // rather than the file title — the title says which country this is.
      const bits = [rec.author ? `Photo: ${rec.author}` : "Wikimedia Commons",
                    rec.licence.label,
                    rec.describeUrl.replace(/^https:\/\//, "")].filter(Boolean);
      const full = bits.join(" · ");
      let line = full;
      ctx.font = `400 ${credPx}px "Karla", sans-serif`;
      ctx.fillStyle = opts.at;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      while(line.length > 12 && ctx.measureText(line).width > cellW){ line = line.slice(0, -2); }
      if(line !== full) line = line.replace(/\s+\S*$/, "") + "…";
      ctx.fillText(line, cellX + cellW/2, cellY + plateH + credPx * 0.4);
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   Panels
   ═══════════════════════════════════════════════════════════ */

function renderFacts(){
  const dl = $("factsList");
  dl.replaceChildren();
  if(!currency && !info){ $("facts").hidden = true; return; }

  // The panel shows everything the app knows; red marks what the sheet omits.
  for(const r of allFactRows()){
    const dt = document.createElement("dt"); dt.textContent = r.label;   // text, never markup
    const dd = document.createElement("dd");
    dd.textContent = r.value;
    if(r.withheld) dd.className = "reveal";
    dl.append(dt, dd);
  }
  const subs = subdivisionNames();
  $("factsSub").textContent = info
    ? (info.leadImageVia ? `Illustration found via the ${info.leadImageVia}.` : "")
    : "No currency article was found, so only CLDR data is shown.";
  $("factsNote").textContent = [
    "Red values are not on the sheet. Symbol, base unit and subdivision names each have their own switch.",
    info && !subs.length ? "This article records no subdivision name, so that switch adds nothing." : "",
    leadNote
  ].filter(Boolean).join(" ");
  $("facts").hidden = false;
}

function renderSources(){
  const dl = $("sourceList");
  dl.replaceChildren();
  const row = (term, href, label) => {
    const dt = document.createElement("dt"); dt.textContent = term;
    const dd = document.createElement("dd");
    if(href){
      const a = document.createElement("a");
      a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.textContent = label;                    // text, never markup
      dd.append(a);
    } else dd.textContent = label;
    dl.append(dt, dd);
  };

  selected.forEach((rec, i) => {
    row(`Image ${i + 1}`, rec.describeUrl,
        `${rec.licence.label}${rec.author ? " · " + rec.author : ""} — file page`);
  });
  if(info) row("Currency facts", info.url, `${info.title} — English Wikipedia, CC BY-SA 4.0`);
  if($("optArticleImage").checked && articleImage)
    row("Article illustration", articleImage.describeUrl,
        `${articleImage.licence.label}${articleImage.nonFree ? " · not a free licence" : ""}` +
        `${articleImage.author ? " · " + articleImage.author : ""} — file page on Wikipedia`);
  row("Country and currency", "", `Unicode CLDR ${CLDR_VERSION}`);

  const sa = selected.filter(r => r.licence.shareAlike);
  $("caveat").textContent =
    "Licences come from each file's metadata, which is parsed free text rather than structured " +
    "data, so open a file page if you need to be sure. Attribution is drawn on the sheet for " +
    "images whose licence asks for it.";
  $("sources").hidden = false;
}

/* ═══════════════════════════════════════════════════════════
   Picker
   ═══════════════════════════════════════════════════════════ */

function licenceAllowed(rec){
  const mode = $("licFilter").value;
  if(mode === "all") return true;
  if(mode === "pd") return rec.licence.id === "pd";
  return rec.licence.id === "pd" || rec.licence.id === "by";
}

function renderGrid(){
  const list = candidates.filter(licenceAllowed);
  $("pickerCount").textContent =
    `${list.length} shown of ${candidates.length} found · ${selected.length} of ${MAX_SELECTED} chosen`;
  $("pickerHint").textContent = "Click a thumbnail to add or remove it";

  $("grid").replaceChildren(...list.map(rec => {
    const tile = document.createElement("div");
    tile.className = "tile" + (selected.includes(rec) ? " on" : "");

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    const img = document.createElement("img");
    img.src = rec.thumb; img.alt = ""; img.loading = "lazy";
    thumb.append(img);
    thumb.addEventListener("click", () => toggleSelect(rec));

    const meta = document.createElement("div");
    meta.className = "meta";

    const lic = document.createElement("span");
    lic.className = "lic " + (rec.licence.id === "pd" ? "pd" : rec.licence.id === "by" ? "by" : "sa");
    lic.textContent = rec.licence.label + (rec.licence.shareAlike ? " · share-alike" : "");

    let flag = null;
    if(rec.fromArticle){
      flag = document.createElement("span");
      flag.className = "lic article";
      flag.textContent = "from the article";
    }

    /*
      The file name is not shown: Commons names files things like
      "50 Baht 1985 obverse.jpg", which gives the answer away to whoever is
      building the sheet. The year badge carries the historic-or-current
      signal without naming the country, and the file page has the rest.
    */
    const nameRow = document.createElement("div");
    nameRow.className = "row";
    if(rec.year){
      const year = document.createElement("span");
      year.className = "year";
      year.textContent = rec.year;
      year.title = "Year found in the file name — open the file page to be sure";
      nameRow.append(year);
    } else {
      const unknown = document.createElement("span");
      unknown.className = "who";
      unknown.textContent = "no year in the file name";
      nameRow.append(unknown);
    }

    const who = document.createElement("span");
    who.className = "who";
    who.textContent = rec.author || "author not stated";   // text, never markup

    const foot = document.createElement("div");
    foot.className = "row";
    const sel = document.createElement("select");
    for(const id of SECTION_ORDER) sel.append(new Option(own(SECTION_LABEL, id), id));
    sel.value = rec.section;
    sel.addEventListener("change", () => { rec.section = sel.value; refresh(); });
    const link = document.createElement("a");
    link.href = rec.describeUrl;
    link.target = "_blank"; link.rel = "noopener noreferrer";
    link.textContent = "File page";
    link.className = "filelink";
    link.title = "Open on Commons to check the date and description";
    foot.append(sel, link);

    meta.append(...[lic, flag, nameRow, who, foot].filter(Boolean));

    tile.append(thumb, meta);
    return tile;
  }));
  $("picker").hidden = !candidates.length;
}

function toggleSelect(rec){
  const at = selected.indexOf(rec);
  if(at >= 0) selected.splice(at, 1);
  else if(selected.length >= MAX_SELECTED){
    note(`${MAX_SELECTED} images is as many as fit on one sheet.`);
    return;
  } else {
    selected.push(rec);
  }
  note("");
  renderGrid();
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Country picking
   ═══════════════════════════════════════════════════════════ */

let countryMatches = [], countryCursor = 0;

function searchCountries(q){
  const n = norm(q);
  if(!n) return [];
  const scored = [];
  for(const c of COUNTRIES){
    const forms = [c.name, ...(c.aliases || [])].filter(Boolean).map(bareName);
    const code = c.code.toLowerCase();
    let score = -1;
    if(n.length === 2 && code === n) score = 0;
    else if(forms.includes(n)) score = 1;
    else if(forms.some(f => f.startsWith(n))) score = 2;
    else if(code.startsWith(n) && n.length <= 2) score = 3;
    else if(forms.some(f => f.includes(n))) score = 4;
    if(score >= 0) scored.push({c, score});
  }
  return scored.sort((a,b) => a.score - b.score || a.c.name.localeCompare(b.c.name))
               .slice(0, 9).map(s => s.c);
}

function renderCountryResults(){
  $("countryResults").replaceChildren(...countryMatches.map((c, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.code = c.code;
    if(i === countryCursor) b.className = "on";
    const code = document.createElement("code");
    code.textContent = c.code;                    // text, never markup
    const label = document.createElement("span");
    label.textContent = c.name;
    b.append(code, label);
    return b;
  }));
}

async function pickCountry(c){
  if(!c) return;
  chosen = c;
  $("country").value = c.name;
  countryMatches = []; renderCountryResults();
  candidates = []; selected = []; info = null; articleImage = null;
  articleImageTouched = false;
  $("grid").replaceChildren();
  $("facts").hidden = true;
  note("");
  await refresh();

  currency = currencyFor(c.code);
  if(!currency){
    note("CLDR lists no current legal tender for this territory.", true);
    return;
  }

  progress("Asking Commons what it has", true);
  try {
    const cats = categoryCandidates(c, currency);
    const seen = new Set();
    const found = [];
    for(const section of SECTION_ORDER){
      for(const cat of cats[section]){
        if(found.length >= MAX_FILES) break;
        let titles = [];
        try { titles = await filesIn(cat, 200); } catch (e) { continue; }
        for(const t of titles){
          if(seen.has(t) || found.length >= MAX_FILES) continue;
          seen.add(t);
          found.push({title: t, section});
        }
      }
    }
    if(!found.length){
      note("Commons lists no images in the categories tried for this country.", true);
    } else {
      progress(`Reading licences for ${found.length} files`, true);
      const bySection = {notes: [], coins: []};
      for(const f of found) bySection[f.section].push(f.title);
      const all = [];
      for(const section of SECTION_ORDER){
        if(bySection[section].length) all.push(...await fileInfo(bySection[section], section));
      }
      candidates = all;
      renderGrid();
    }

    // Facts are a bonus; a failure here must not lose the images.
    progress("Looking up currency facts", true);
    try { info = await loadCurrencyInfo(currency); }
    catch (e) { info = null; }
    renderFacts();

    // The article's illustration goes to the front of the picker, since it is
    // usually the clearest view of the money currently in use.
    leadNote = "";
    const leadNames = (info && info.leadCandidates) || [];
    if(leadNames.length){
      const why = [];
      let placed = false;

      // 1. Commons, under each candidate name.
      for(const name of leadNames){
        try {
          const [lead] = await fileInfo(["File:" + name], "notes");
          if(lead){
            lead.fromArticle = true;
            candidates = [lead, ...candidates.filter(r => r.pageid !== lead.pageid)];
            renderGrid();
            placed = true;
            break;
          }
          why.push("not on Commons");
        } catch (e) { why.push("Commons lookup failed"); }
      }

      // 2. Wikipedia's own file store, under each candidate name.
      if(!placed){
        for(const name of leadNames){
          articleImage = await wikipediaFileInfo(name, why);
          if(articleImage) break;
        }
      }

      // 3. Whatever files the article actually uses, matched loosely.
      if(!placed && !articleImage && info.title){
        const wanted = new Set(leadNames.map(looseKey));
        const titles = await articleFileTitles(info.title);
        const hit = titles.find(t => wanted.has(looseKey(t)));
        if(hit){
          articleImage = await wikipediaFileInfo(hit.replace(/^File:/, ""), why);
        } else if(titles.length){
          why.push(`none of the article's ${titles.length} files matched by name`);
          // Take a banknote-looking file from the article rather than nothing.
          const likely = titles.find(t => /\b(banknote|bank note|note|bill|currency|money|coin)s?\b/i.test(t)
                                          && !/\b(logo|icon|flag|seal|map|symbol)\b/i.test(t));
          if(likely){
            articleImage = await wikipediaFileInfo(likely.replace(/^File:/, ""), why);
            if(articleImage) articleImage.guessedFromArticle = true;
          }
        }
      }

      if(placed) leadNote = "";
      else if(articleImage)
        leadNote = (articleImage.guessedFromArticle
            ? "Used another image from the article, since the named illustration couldn't be resolved. "
            : "The article's illustration is hosted on Wikipedia rather than Commons. ") +
          `Licence: ${articleImage.licence.label}. Its own switch adds it to the sheet.`;
      else
        leadNote = `Couldn't resolve the article's illustration. Tried: ${why.join("; ")}.`;
    } else if(info){
      leadNote = "This article has no illustration the app could resolve.";
    }
    renderFacts();
    // Without this the switch is created and never shown.
    syncExportState();
    await refresh();
  } catch (e) {
    note("Commons didn't answer: " + cleanText(e && e.message, 60) + ".", true);
  } finally {
    progress(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

/* Images, the article illustration, or facts on their own — any of these is a sheet. */
function hasSheetContent(){
  if(selected.length) return true;
  if($("optArticleImage").checked && articleImage) return true;
  if($("optFacts").checked && factRows(currentOptions()).length) return true;
  return false;
}

async function refresh(){
  const token = ++busy;
  syncExportState();
  if(!hasSheetContent()){
    $("sheetWrap").hidden = true;
    $("empty").style.display = candidates.length ? "none" : "block";
    $("sources").hidden = true;
    return;
  }
  progress("Drawing", true);
  try {
    await drawSheet($("sheet"), currentOptions());
    if(token !== busy) return;
    $("sheetWrap").hidden = false;
    $("empty").style.display = "none";
    if(tainted) note("This browser wouldn't let the page read Wikimedia's images back, so export is unavailable. Serving the file over http://localhost rather than opening it directly usually fixes it.", true);
    renderSources();
  } catch (e) {
    note("Couldn't draw the sheet: " + cleanText(e && e.message, 80), true);
  } finally {
    if(token === busy) progress(null);
    syncExportState();
  }
}

function syncExportState(){
  const ready = hasSheetContent() && !tainted;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("revealTag").hidden = !($("optSymbol").checked || $("optBaseUnit").checked
                            || $("optSubdivision").checked);

  /*
    Shown either way, so the option is discoverable, but inert and cleared
    when the article has no illustration — a ticked box that draws nothing
    is worse than a greyed one.
  */
  const box = $("optArticleImage"), tag = $("articleLicence"), row = $("articleImageRow");
  box.disabled = !articleImage;
  row.classList.toggle("off", !articleImage);
  if(!articleImage) box.checked = false;
  else if(!articleImageTouched) box.checked = true;   // restore the default once one arrives
  tag.textContent = articleImage ? articleImage.licence.label : "none found";
  tag.title = articleImage ? "Hosted on Wikipedia rather than Commons" : "";
  $("factsPosField").hidden = !$("optFacts").checked;
}

async function exportSheet(type, ext){
  const opts = currentOptions();
  if(type === "image/jpeg" && opts.transparent) opts.transparent = false;
  progress("Rendering for export", true);
  try {
    const canvas = document.createElement("canvas");
    await drawSheet(canvas, opts);
    const blob = await new Promise(res => canvas.toBlob(res, type, 0.95));
    if(!blob){ note("The browser refused to encode the image.", true); return; }

    // The filename shouldn't give away what the sheet is hiding.
    let slug;
    if(opts.baseUnit && currency){
      slug = currency.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    } else {
      let h = 0;
      const seed = selected.map(r => r.pageid).join("|");
      for(let i = 0; i < seed.length; i++) h = (h*31 + seed.charCodeAt(i)) >>> 0;
      slug = h.toString(36).slice(0, 6);
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `currency-${slug || "sheet"}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    note(selected.some(r => r.section === "notes")
      ? "Saved. Reproducing banknotes is restricted by law in many countries independently of copyright — this app cannot check whether the exported size complies."
      : "");
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  } finally {
    progress(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

$("country").addEventListener("input", e => {
  countryMatches = searchCountries(e.target.value); countryCursor = 0; renderCountryResults();
});
$("country").addEventListener("keydown", e => {
  if(!countryMatches.length) return;
  if(e.key === "ArrowDown"){ countryCursor = (countryCursor+1) % countryMatches.length; renderCountryResults(); e.preventDefault(); }
  if(e.key === "ArrowUp"){ countryCursor = (countryCursor-1+countryMatches.length) % countryMatches.length; renderCountryResults(); e.preventDefault(); }
  if(e.key === "Enter"){ pickCountry(countryMatches[countryCursor]); e.preventDefault(); }
  if(e.key === "Escape"){ countryMatches = []; renderCountryResults(); }
});
$("countryResults").addEventListener("click", e => {
  const b = e.target.closest("button");
  if(b) pickCountry(COUNTRIES.find(c => c.code === b.dataset.code));
});

$("licFilter").addEventListener("change", () => {
  selected = selected.filter(licenceAllowed);
  renderGrid(); refresh();
});

$("frame").addEventListener("change", () => { $("customSize").hidden = $("frame").value !== "custom"; refresh(); });
let sizeTimer;
["customW","customH"].forEach(id => $(id).addEventListener("input", () => {
  clearTimeout(sizeTimer); sizeTimer = setTimeout(refresh, 400);
}));

["optSections","optFacts","optSymbol","optBaseUnit","optSubdivision",
  "optTransparent","optSpecimen","optArticleImage"].forEach(id =>
  $(id).addEventListener("change", () => {
    if(id === "optArticleImage") articleImageTouched = true;
    syncExportState(); refresh();
  }));

let alphaTimer;
$("specimenAlpha").addEventListener("input", () => {
  clearTimeout(alphaTimer); alphaTimer = setTimeout(refresh, 220);
});

$("factsTop").addEventListener("click", () => { setSeg($("factsTop"), $("factsBottom")); refresh(); });
$("factsBottom").addEventListener("click", () => { setSeg($("factsBottom"), $("factsTop")); refresh(); });

let capTimer;
$("capText").addEventListener("input", () => {
  $("capPosField").hidden = !cleanText($("capText").value, 120);
  clearTimeout(capTimer); capTimer = setTimeout(refresh, 300);
});
$("capTop").addEventListener("click", () => { setSeg($("capTop"), $("capBottom")); refresh(); });
$("capBottom").addEventListener("click", () => { setSeg($("capBottom"), $("capTop")); refresh(); });

function setSeg(on, off){
  on.setAttribute("aria-pressed", "true");
  off.setAttribute("aria-pressed", "false");
}

function bindColour(swatchId, hexId){
  const swatch = $(swatchId), hex = $(hexId);
  swatch.addEventListener("input", () => {
    hex.value = swatch.value.toLowerCase();
    hex.setAttribute("aria-invalid", "false");
    refresh();
  });
  hex.addEventListener("input", () => {
    const parsed = parseHex(hex.value);
    hex.setAttribute("aria-invalid", parsed ? "false" : "true");
    if(!parsed) return;
    swatch.value = parsed;
    refresh();
  });
  hex.addEventListener("blur", () => {
    const parsed = parseHex(hex.value);
    hex.value = parsed || swatch.value.toLowerCase();
    hex.setAttribute("aria-invalid", "false");
  });
}
bindColour("fgColor", "fgHex");
bindColour("bgColor", "bgHex");
bindColour("atColor", "atHex");

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

$("capPosField").hidden = !cleanText($("capText").value, 120);
syncExportState();
progress("Loading reference data", true);
loadReference()
  .then(() => {
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — name or code`;
    input.focus();
    progress(null);
  })
  .catch(err => {
    progress(null);
    note("Couldn't load the reference data: " + cleanText(err && err.message, 70) +
         ". Check your connection and reload.", true);
  });
