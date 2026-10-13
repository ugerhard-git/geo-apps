/* ═══════════════════════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════════════════════ */

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const CLDR_TERRITORIES =
  "https://cdn.jsdelivr.net/npm/cldr-localenames-full@47/main/en/territories.json";

/*
  Infobox rows allowed onto the exported sheet. Country code is the obvious
  giveaway, but issuer names a national agency, slogan identifies a state, and
  the country row says it outright — so the sheet carries only rows that
  describe the plate itself.
*/
const SHEET_FIELDS = [
  "front plate", "rear plate", "size", "serial format", "material",
  "colour (front)", "colour (rear)", "color (front)", "color (rear)", "introduced"
];
/*
  Commons names these "License plates of X". "Vehicle registration plates" is
  the English Wikipedia title, which Commons records only as an interwiki
  equivalent — using it returns an empty list rather than an error. Several
  roots are tried, then a prefix scan, so a rename can't take the app down
  silently again.
*/
const ROOT_CATEGORIES = [
  "Category:License plates by country",
  "Category:Licence plates by country",
  "Category:Vehicle registration plates by country",
  "Category:Number plates by country"
];
const NAME_PREFIXES = [
  "License plates of ", "Licence plates of ",
  "Vehicle registration plates of ", "Number plates of "
];
const UPLOAD_HOST = "upload.wikimedia.org";

/*
  A generous cap, because the filters make a long list usable: a small one
  silently kept whichever files Commons happened to list first.
*/
const MAX_FILES    = 400;    // per country, across subcategories
const MAX_SELECTED = 12;
const THUMB_W      = 400;
const FULL_W       = 1200;   // plenty for a sheet, far less than originals
const MAX_PIXELS   = 32e6;

/* Words that suggest a plate isn't for an ordinary private car. */
const SECTION_HINTS = [
  // Whole words where a prefix would over-match — "van" must not catch "vanity".
  ["other",      /\b(army|police|dealer|export|trade)\b/i],
  ["commercial", /\b(bus|van|hgv|taxi|goods|cargo|coach)\b/i],
  // Prefixes, with a leading boundary only, so "diplomatic" and "military" match.
  ["other",      /\b(diplomat|militar|temporar|transit|motorcycle|moped|tractor|agricultur|historic|vintage|oldtimer|classic)/i],
  ["commercial", /\b(commercial|lorr|truck|haulage|trailer|transport|utility)/i]
];

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

/*
  Commons metadata is parsed free text, not structured data: the Artist field
  routinely contains anchors and spans. Parse it in a detached document and
  keep only the text, so nothing from the API can become markup here.
*/
function htmlToText(raw, max){
  const s = String(raw || "");
  if(!s) return "";
  let text = s;
  try {
    const doc = new DOMParser().parseFromString(s, "text/html");
    // textContent includes the contents of script and style elements, which is
    // harmless but ugly; drop them before reading.
    doc.querySelectorAll && doc.querySelectorAll("script,style").forEach(n => n.remove());
    text = doc.body ? doc.body.textContent : s;
  } catch (e) {
    text = s.replace(/<[^>]*>/g, " ");
  }
  return cleanText(text, max || 80);
}

/* ═══════════════════════════════════════════════════════════
   Country names and codes

   Commons names its categories in its own way; CLDR supplies the standard
   English name and the ISO code, so the picker answers to either.
   ═══════════════════════════════════════════════════════════ */

const NOT_A_COUNTRY = new Set(["EU","EZ","UN","QO","XA","XB","ZZ","XK"]);

async function loadTerritories(){
  const r = await fetch(CLDR_TERRITORIES);
  if(!r.ok) throw new Error("HTTP " + r.status);
  const data = await r.json();
  const t = data && data.main && data.main.en && data.main.en.localeDisplayNames
            && data.main.en.localeDisplayNames.territories;
  if(!t || typeof t !== "object") throw new Error("unexpected CLDR shape");

  const byCode = new Map();
  for(const key of Object.keys(t)){
    const value = own(t, key);
    if(typeof value !== "string") continue;
    const code = key.split("-")[0];
    if(!/^[A-Z]{2}$/.test(code) || NOT_A_COUNTRY.has(code)) continue;
    const entry = byCode.get(code) || {code, name: "", aliases: []};
    if(key === code) entry.name = cleanText(value, 80);
    else entry.aliases.push(cleanText(value, 80));   // -alt-short, -alt-variant
    byCode.set(code, entry);
  }
  return [...byCode.values()].filter(e => e.name);
}

/* Commons says "the United Kingdom"; CLDR says "United Kingdom". */
const bareName = n => norm(String(n).replace(/^the\s+/i, ""));

function attachCodes(countries, territories){
  const index = new Map();
  for(const t of territories){
    index.set(bareName(t.name), t);
    for(const a of t.aliases) if(!index.has(bareName(a))) index.set(bareName(a), t);
  }
  for(const c of countries){
    const hit = index.get(bareName(c.name));
    if(hit){ c.code = hit.code; c.official = hit.name; c.aliases = hit.aliases; }
    else { c.code = ""; c.official = ""; c.aliases = []; }
  }
  return countries;
}

/* ═══════════════════════════════════════════════════════════
   Commons API
   ═══════════════════════════════════════════════════════════ */

async function commons(params){
  const p = new URLSearchParams({format: "json", formatversion: "2", origin: "*", ...params});
  const r = await fetch(COMMONS_API + "?" + p.toString());
  if(!r.ok){ const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
  const data = await r.json();
  if(data && data.error) throw new Error(String(data.error.code || "api error").slice(0, 60));
  return data;
}

async function subcategoriesOf(title, limit){
  const data = await commons({
    action: "query", list: "categorymembers", cmtitle: title,
    cmtype: "subcat", cmlimit: String(limit || 500)
  });
  const rows = (data && data.query && data.query.categorymembers) || [];
  return rows.map(r => typeof r.title === "string" ? r.title : "").filter(Boolean);
}

async function filesIn(title, limit){
  const data = await commons({
    action: "query", list: "categorymembers", cmtitle: title,
    cmtype: "file", cmlimit: String(limit || 200)
  });
  const rows = (data && data.query && data.query.categorymembers) || [];
  return rows.map(r => typeof r.title === "string" ? r.title : "").filter(Boolean);
}

/* Licence, author and URLs for up to 50 files at a time. */
async function fileInfo(titles){
  const out = [];
  for(let i = 0; i < titles.length; i += 50){
    const chunk = titles.slice(i, i + 50);
    const data = await commons({
      // Categories ride along in the same request: they place a plate far more
      // reliably than reading its file name, and they give the filter
      // something real to match.
      action: "query", prop: "imageinfo|categories", titles: chunk.join("|"),
      cllimit: "500", clshow: "!hidden",
      iiprop: "url|extmetadata|size|mime", iiurlwidth: String(THUMB_W)
    });
    const pages = (data && data.query && data.query.pages) || [];
    for(const page of pages){
      const info = page && Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      if(!info) continue;
      const rec = describeFile(page, info);
      if(rec) out.push(rec);
    }
  }
  return out;
}

/* Only Wikimedia's own upload host is ever loaded as an image. */
function firstSafeImageUrl(...candidates){
  for(const c of candidates){ const ok = safeImageUrl(c); if(ok) return ok; }
  return null;
}

function safeImageUrl(u){
  try {
    const url = new URL(String(u));
    if(url.protocol !== "https:" || url.hostname !== UPLOAD_HOST) return null;
    return url.href;
  } catch (e) { return null; }
}

/* Ask MediaWiki for a wider render of the same thumbnail, never an upscale. */
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
  A year in the file name is the quickest signal that a plate is historic
  rather than current. It is a hint, not a fact — the file page settles it.
*/
function yearInTitle(title){
  const years = String(title).match(/\b(1[5-9]\d{2}|20[0-4]\d)\b/g);
  if(!years) return "";
  return years.map(Number).sort((a,b) => a - b)[0].toString();
}

function describeFile(page, info){
  const ex = info.extmetadata || {};
  const val = k => { const f = own(ex, k); return f && typeof f.value === "string" ? f.value : ""; };

  if(typeof info.mime === "string" && !/^image\//.test(info.mime)) return null;

  // Each candidate is tried in turn. The old form took thumburl if it was
  // present at all, so an unusable thumbnail lost the file even when the
  // full-size URL was perfectly good.
  const thumb = firstSafeImageUrl(info.thumburl, info.url);
  if(!thumb) return null;
  // The picker wants small images; the sheet wants a usable one. MediaWiki
  // thumbnails carry their width in the path, so ask for a wider render of the
  // same file rather than pulling the multi-megabyte original.
  const full = widenThumb(thumb, info.width) || thumb;

  const title = cleanText(String(page.title || "").replace(/^File:/, ""), 140);
  // Every plate has to be citable, and the permalink is built from the page id.
  const pageid = Number.isInteger(page.pageid) && page.pageid > 0 ? page.pageid : null;
  if(!pageid) return null;

  const rawCats = Array.isArray(page.categories) ? page.categories : [];
  const cats = rawCats.slice(0, 40)
    .map(c => cleanText(String(c && c.title || "").replace(/^Category:/, ""), 90))
    .filter(Boolean);

  return {
    title, pageid, cats,
    // Searchable, never displayed: the file name gives the country away.
    keywords: norm([title, ...cats].join(" ")),
    thumb, full,
    width: Number.isFinite(info.width) ? info.width : 0,
    height: Number.isFinite(info.height) ? info.height : 0,
    author: htmlToText(val("Artist"), 70),
    licence: classifyLicence(htmlToText(val("LicenseShortName"), 40), val("LicenseUrl")),
    describeUrl: pageid ? `https://commons.wikimedia.org/w/index.php?curid=${pageid}` : "",
    year: yearInTitle(String(page.title || "")),
    section: "private",
    regions: []
  };
}

/*
  Anything not recognisable is treated as the strictest case rather than the
  most permissive, so an unparsed licence can never slip into an export as
  though it were public domain.
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

/* A spaced dash or a bracket marks a qualifier; a bare hyphen is part of a
   name like Guinea-Bissau, so it must not be treated as one. */
const QUALIFIER = /\s[-–—]\s|\s\(/;

/* "Category:License plates of Spain" → "Spain" */
function countryNameFrom(title){
  let t = String(title).replace(/^Category:/, "");
  for(const p of NAME_PREFIXES){
    if(t.toLowerCase().startsWith(p.toLowerCase())) return cleanText(t.slice(p.length), 90);
  }
  return "";
}

/* Every category whose title starts with a plate prefix, for when the parent
   category is renamed or a country simply isn't filed under it. */
async function categoriesByPrefix(prefix, limit){
  const data = await commons({
    action: "query", list: "allcategories",
    acprefix: prefix, aclimit: String(limit || 500)
  });
  const rows = (data && data.query && data.query.allcategories) || [];
  return rows.map(r => typeof r === "string" ? r : (r && r.category) || "")
             .filter(Boolean).map(c => "Category:" + c);
}

async function loadCountries(){
  const tried = [];
  for(const root of ROOT_CATEGORIES){
    try {
      const subs = await subcategoriesOf(root, 500);
      const named = subs.filter(t => !QUALIFIER.test(t))
                        .map(t => ({title: t, name: countryNameFrom(t)}))
                        .filter(c => c.name);
      if(named.length) return {list: named, via: root, tried};
      tried.push(`${root} → empty`);
    } catch (e) {
      tried.push(`${root} → ${cleanText(e && e.message, 30)}`);
    }
  }
  // Nothing under a parent category; scan titles instead.
  for(const prefix of NAME_PREFIXES){
    try {
      const cats = await categoriesByPrefix(prefix, 500);
      const named = cats
        .filter(t => !QUALIFIER.test(t))                    // skip qualified subcategories
        .map(t => ({title: t, name: countryNameFrom(t)}))
        .filter(c => c.name);
      if(named.length) return {list: named, via: `titles starting "${prefix}"`, tried};
      tried.push(`prefix "${prefix}" → empty`);
    } catch (e) {
      tried.push(`prefix "${prefix}" → ${cleanText(e && e.message, 30)}`);
    }
  }
  const err = new Error("no plate categories found");
  err.tried = tried;
  throw err;
}

/*
  Commons' own categories say what a plate is far better than its file name
  does, so they are read first and the name is only the fallback.
*/
function guessSection(title, categoryTitle, cats){
  const fromCats = Array.isArray(cats) ? cats.join(" ") : "";
  for(const [name, re] of SECTION_HINTS) if(re.test(fromCats)) return name;
  const hay = `${title} ${categoryTitle || ""}`;
  for(const [name, re] of SECTION_HINTS) if(re.test(hay)) return name;
  return "private";
}

/* Diagrams and sample plates first; roadside photographs carry real numbers. */
function looksLikeDiagram(rec){
  return /\.svg$/i.test(rec.title) || /\b(sample|specimen|diagram|blank|template|muster|mock)\b/i.test(rec.title);
}

/* ═══════════════════════════════════════════════════════════
   Plate requirements, from the English Wikipedia infobox

   Values are shown exactly as the article has them. Coverage is uneven —
   China states front and rear plainly, Germany omits them, and Italy puts
   dimensions in the field — so nothing here is normalised into a tidy
   yes/no that would misrepresent all three.
   ═══════════════════════════════════════════════════════════ */

async function wikipedia(params){
  const p = new URLSearchParams({format: "json", formatversion: "2", origin: "*", ...params});
  const r = await fetch(WIKIPEDIA_API + "?" + p.toString());
  if(!r.ok){ const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
  const data = await r.json();
  if(data && data.error) throw new Error(String(data.error.code || "api error").slice(0, 60));
  return data;
}

const TITLE_OK = /^[^\n\r|#<>[\]{}]{3,120}$/;

function articleCandidates(country){
  const names = [country.official, country.name].filter(Boolean);
  const out = [];
  for(const n of names){
    const bare = n.replace(/^the\s+/i, "");
    out.push(`Vehicle registration plates of ${n}`);
    out.push(`Vehicle registration plates of the ${bare}`);
    out.push(`Vehicle registration plates of ${bare}`);
  }
  return [...new Set(out)].filter(t => TITLE_OK.test(t)).slice(0, 8);
}

/* The first candidate that exists, else a title search, else nothing. */
async function findArticle(country){
  const cands = articleCandidates(country);
  if(cands.length){
    const data = await wikipedia({action: "query", titles: cands.join("|"), redirects: "1"});
    const pages = (data && data.query && data.query.pages) || [];
    const live = pages.filter(pg => pg && !pg.missing && typeof pg.title === "string");
    if(live.length){
      // Preserve candidate order rather than whatever the API returns.
      for(const c of cands){
        const hit = live.find(pg => pg.title === c) || null;
        if(hit) return hit.title;
      }
      return live[0].title;
    }
  }
  const q = (country.official || country.name || "").replace(/^the\s+/i, "");
  if(!q) return null;
  const found = await wikipedia({
    action: "query", list: "search", srnamespace: "0", srlimit: "5",
    srsearch: `intitle:"Vehicle registration plates of" ${q}`
  });
  const rows = (found && found.query && found.query.search) || [];
  const first = rows.find(r => r && typeof r.title === "string" &&
    /^Vehicle registration plates of /i.test(r.title));
  return first ? first.title : null;
}

const REF_MARK = /\[\s*(\d+|citation needed|clarification needed|note \d+)\s*\]/gi;

/* A control character, so a real middle dot in the data is never touched. */
const MARK = "\u001f";

/* Elements that end a line in an infobox cell. */
const BLOCKISH = new Set(["DIV","P","LI","TR","UL","OL","DD","DT","SECTION",
                          "TABLE","TBODY","HR","H1","H2","H3","H4","H5","H6"]);

/*
  textContent runs adjacent elements together, so "520 mm × 110 mm" and
  "20.5 in × 4.3 in" arrive as one unreadable string. Walk the node instead,
  separating block elements and line breaks, and keeping a space between
  adjacent inline elements that would otherwise collide.
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
    if(BLOCKISH.has(tag)){
      out += MARK + inner + MARK;
    } else {
      if(out && !/\s$/.test(out) && !/^\s/.test(inner)) out += " ";
      out += inner;
    }
  }
  return out;
}

/* Collapse the markers richText leaves behind into single separators. */
function tidy(raw, max){
  let t = String(raw || "").replace(REF_MARK, " ");
  t = t.replace(/[\s\u001f]*\u001f[\s\u001f]*/g, MARK);   // runs become one
  t = t.replace(/^\u001f+|\u001f+$/g, "");                 // none at the ends
  t = t.replace(/\u001f/g, " · ");
  return cleanText(t, max);
}

/*
  The lead section's rendered infobox, read as label/value text. Nothing from
  this response is ever inserted into the page as markup.
*/
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
    rows.push({label, value, key});
  }
  const finalTitle = cleanText(data.parse.title || title, 120);
  return rows.length ? {
    title: finalTitle,
    url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(finalTitle.replace(/ /g, "_")),
    rows
  } : null;
}

/* ═══════════════════════════════════════════════════════════
   Image loading
   ═══════════════════════════════════════════════════════════ */

let CORS_MODE = "unknown";     // "unknown" | "anonymous" | "none"
let tainted = false;
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

/*
  Wikimedia is expected to send Access-Control-Allow-Origin. If it doesn't, an
  anonymous request fails outright, so fall back to a plain one: the sheet
  still draws, but the canvas becomes unreadable and export has to stop.
*/
async function loadImage(url){
  if(imageCache.has(url)) return imageCache.get(url);
  let img;
  if(CORS_MODE === "none"){
    img = await rawLoad(url, false);
  } else {
    try {
      img = await rawLoad(url, true);
      CORS_MODE = "anonymous";
    } catch (e) {
      if(CORS_MODE === "anonymous") throw e;
      img = await rawLoad(url, false);
      CORS_MODE = "none";
      tainted = true;
    }
  }
  imageCache.set(url, img);
  return img;
}

/* ═══════════════════════════════════════════════════════════
   Blur

   Canvas filter support has been uneven in Safari, so a downscale-and-upscale
   pass stands in where it's missing. Both give the soft, unreadable look of a
   blurred plate; neither claims to reproduce anyone's algorithm.
   ═══════════════════════════════════════════════════════════ */

let canvasFilterSupported = null;

function supportsCanvasFilter(){
  if(canvasFilterSupported !== null) return canvasFilterSupported;
  try {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    ctx.filter = "blur(2px)";
    canvasFilterSupported = ctx.filter === "blur(2px)";
  } catch (e) { canvasFilterSupported = false; }
  return canvasFilterSupported;
}

/*
  Blur a rectangle of src into dest. These must be different canvases: reading
  a canvas while writing to it makes the browser blur only part of the image,
  because the source is being rewritten as it is read.
*/
function blurInto(dest, src, sx, sy, sw, sh, radius){
  const ctx = dest.getContext("2d");
  if(dest === src) throw new Error("blurInto needs a separate source canvas");
  if(radius <= 0.5){
    ctx.drawImage(src, sx, sy, sw, sh, sx, sy, sw, sh);
    return;
  }

  if(supportsCanvasFilter()){
    // Reach beyond the rectangle so the blur pulls in real neighbouring
    // pixels, clamped to what exists, and drawn 1:1 so nothing shifts.
    const o = Math.ceil(radius * 2);
    const x0 = Math.max(0, sx - o), y0 = Math.max(0, sy - o);
    const x1 = Math.min(src.width,  sx + sw + o);
    const y1 = Math.min(src.height, sy + sh + o);
    const rw = x1 - x0, rh = y1 - y0;
    if(rw <= 0 || rh <= 0) return;

    ctx.save();
    ctx.beginPath(); ctx.rect(sx, sy, sw, sh); ctx.clip();
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(src, x0, y0, rw, rh, x0, y0, rw, rh);
    ctx.restore();
    return;
  }

  // No canvas filter: shrink the region hard, then let the browser's smoothing
  // enlarge it again. Different arithmetic, similar look.
  const f = Math.max(2, Math.round(radius));
  const tw = Math.max(1, Math.round(sw / f)), th = Math.max(1, Math.round(sh / f));
  const small = document.createElement("canvas");
  small.width = tw; small.height = th;
  const sctx = small.getContext("2d");
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(src, sx, sy, sw, sh, 0, 0, tw, th);

  ctx.save();
  ctx.beginPath(); ctx.rect(sx, sy, sw, sh); ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, tw, th, sx, sy, sw, sh);
  ctx.restore();
}

/*
  A blur at the very edge of an image has nothing outside to sample, so it
  fades toward transparent and leaves a pale border. Padding the source with a
  stretched copy of itself gives it something to pull in.
*/
function paddedCopy(src, pad){
  const c = document.createElement("canvas");
  c.width = src.width + pad*2;
  c.height = src.height + pad*2;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, c.width, c.height);   // smear outward
  ctx.drawImage(src, 0, 0, src.width, src.height, pad, pad, src.width, src.height);
  return c;
}

/*
  Produce a canvas of the plate with blur applied. Regions are stored as
  fractions of the image so they survive any scaling.
*/
function renderPlate(img, rec, opts){
  const w = Math.max(1, img.naturalWidth || img.width);
  const h = Math.max(1, img.naturalHeight || img.height);

  const base = document.createElement("canvas");
  base.width = w; base.height = h;
  base.getContext("2d").drawImage(img, 0, 0, w, h);

  const radius = (opts.blurAmount / 1000) * w;
  if(radius <= 0.5) return base;

  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const ctx = out.getContext("2d");
  ctx.drawImage(base, 0, 0);                 // start from the untouched image

  if(opts.blurWhole || !rec.regions.length){
    const pad = Math.ceil(radius * 2);
    const padded = paddedCopy(base, pad);
    const tmp = document.createElement("canvas");
    tmp.width = padded.width; tmp.height = padded.height;
    tmp.getContext("2d").drawImage(padded, 0, 0);
    blurInto(tmp, padded, 0, 0, padded.width, padded.height, radius);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(tmp, pad, pad, w, h, 0, 0, w, h);
  } else {
    for(const r of rec.regions){
      const rx = clamp(r.x, 0, 1) * w, ry = clamp(r.y, 0, 1) * h;
      const rw = Math.min(clamp(r.w, 0, 1) * w, w - rx);
      const rh = Math.min(clamp(r.h, 0, 1) * h, h - ry);
      if(rw < 2 || rh < 2) continue;
      blurInto(out, base, Math.round(rx), Math.round(ry), Math.round(rw), Math.round(rh), radius);
    }
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

let COUNTRIES = [];            // {title, name}
let chosen = null;             // the country record
let candidates = [];           // everything Commons offered
let selected = [];             // what's on the sheet, in order
let editing = null;            // record whose regions are being drawn
let busy = 0;
let sourceVia = "";
let shareAlikeWarned = false;
let spec = null;            // {title, rows} from the Wikipedia infobox

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
    fg: safeColour($("fgColor").value, "#e4e6ea"),
    bg: safeColour($("bgColor").value, "#12141a"),
    at: safeColour($("atColor").value, "#8b91a0"),
    transparent: $("optTransparent").checked,
    sections: $("optSections").checked,
    country: $("optCountry").checked,
    spec: $("optSpec").checked,
    specTop: $("specTop").getAttribute("aria-pressed") === "true",
    caption: cleanText($("capText").value, 120),
    capTop: $("capTop").getAttribute("aria-pressed") === "true",
    blurWhole: $("blurWhole").getAttribute("aria-pressed") === "true",
    blurAmount: clamp(+$("blurAmount").value, 0, 150)
  };
}

/* ═══════════════════════════════════════════════════════════
   Drawing the sheet
   ═══════════════════════════════════════════════════════════ */

const SECTION_LABEL = {private: "Private vehicles", commercial: "Commercial vehicles", other: "Other plates"};
const SECTION_ORDER = ["private", "commercial", "other"];

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
    ctx.font = `600 ${capPx}px "Archivo Narrow", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let px = capPx, t = opts.caption;
    while(px > 14 && ctx.measureText(t).width > W - pad*2){ px -= 2; ctx.font = `600 ${px}px "Archivo Narrow", sans-serif`; }
    if(opts.capTop){ ctx.fillText(t, W/2, top + px*0.6); top += px * 1.9; }
    else           { ctx.fillText(t, W/2, bottom - px*0.6); bottom -= px * 1.9; }
  }

  if(opts.spec){
    const rows = specRowsForSheet();
    if(rows.length){
      const px = clamp(Math.round(H * 0.022), 11, 30);
      const lines = rows.map(r => `${r.label}: ${r.value}`);
      ctx.font = `400 ${px}px "Archivo", sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";

      // Pack as many per line as fit, so the block stays compact.
      const packed = [];
      let cur = "";
      for(const line of lines){
        const test = cur ? cur + "   ·   " + line : line;
        if(cur && ctx.measureText(test).width > W - pad*2){ packed.push(cur); cur = line; }
        else cur = test;
      }
      if(cur) packed.push(cur);

      const creditPx = Math.max(9, Math.round(px * 0.62));
      const blockH = packed.length * px * 1.45 + creditPx * 1.9;
      // Above sits under the caption; below sits above the country name.
      let ly = opts.specTop ? top + px * 0.9 : bottom - blockH + px * 0.9;
      ctx.fillStyle = opts.fg;
      ctx.globalAlpha = 0.85;
      for(const line of packed){ ctx.fillText(line, W/2, ly); ly += px * 1.45; }
      ctx.globalAlpha = 1;

      ctx.font = `400 ${creditPx}px "Archivo", sans-serif`;
      ctx.fillStyle = opts.at;
      ctx.fillText("Plate data: English Wikipedia, CC BY-SA 4.0", W/2, ly + creditPx * 0.2);

      if(opts.specTop) top += blockH + px * 0.5;
      else             bottom -= blockH + px * 0.5;
    }
  }

  if(opts.country && chosen){
    const px = Math.round(H * 0.030);
    ctx.font = `500 ${px}px "Archivo", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(chosen.name, W/2, bottom - px*0.7);
    bottom -= px * 1.9;
  }

  const groups = SECTION_ORDER
    .map(id => ({id, items: selected.filter(s => s.section === id)}))
    .filter(g => g.items.length);
  if(!groups.length) return;

  /*
    Blur once per plate, before layout: the grid is sized from the finished
    plate canvases, so blurring and arranging can't disagree about dimensions.
  */
  const prepared = new Map();
  for(const rec of selected){
    let img;
    try { img = await loadImage(rec.full); }
    catch (e) {
      try { img = await loadImage(rec.thumb); }      // wider render unavailable
      catch (e2) { continue; }
    }
    prepared.set(rec, renderPlate(img, rec, opts));
  }

  const bandH = (bottom - top) / groups.length;

  for(let gi = 0; gi < groups.length; gi++){
    const g = groups[gi];
    const items = g.items.filter(r => prepared.has(r));
    if(!items.length) continue;
    const bandTop = top + gi * bandH;
    let y = bandTop;

    if(opts.sections){
      const hPx = clamp(Math.round(bandH * 0.13), 16, 46);
      ctx.font = `600 ${hPx}px "Archivo", sans-serif`;
      ctx.fillStyle = opts.fg;
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = 0.78;
      ctx.fillText(own(SECTION_LABEL, g.id) || "Plates", pad, y + hPx);
      ctx.globalAlpha = 1;
      y += hPx * 1.7;
    }

    drawGrid(ctx, items, prepared, pad, y, W - pad*2,
             bandTop + bandH - y - bandH*0.05, opts);
  }
}

/*
  Lay a section out as a grid. Every column count is tried and the one that
  makes the smallest plate as large as possible wins, so a section of wide
  plates and one of tall plates each get the arrangement that suits them.
*/
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
    const plate = prepared.get(rec);
    if(!plate) return;
    const r = Math.floor(i / cols), c = i % cols;

    // Centre a short final row rather than leaving it hanging on the left.
    const inRow = Math.min(cols, items.length - r * cols);
    const rowW = inRow * cellW + gap * (inRow - 1);
    const cellX = x + (w - rowW) / 2 + c * (cellW + gap);
    const cellY = yTop + r * (cellH + gap);

    const scale = Math.min(cellW / plate.width, plateH / plate.height);
    const dw = Math.max(1, Math.round(plate.width * scale));
    const dh = Math.max(1, Math.round(plate.height * scale));
    ctx.drawImage(plate,
      Math.round(cellX + (cellW - dw) / 2),
      Math.round(cellY + (plateH - dh) / 2), dw, dh);

    if(credPx && rec.licence.attribution){
      // Attribution travels with the image, as CC BY requires, but names the
      // author and a permalink rather than the file title — the title says
      // which country this is.
      const bits = [rec.author ? `Photo: ${rec.author}` : "Wikimedia Commons",
                    rec.licence.label,
                    rec.describeUrl.replace(/^https:\/\//, "")].filter(Boolean);
      const full = bits.join(" · ");
      let line = full;
      ctx.font = `400 ${credPx}px "Archivo", sans-serif`;
      ctx.fillStyle = opts.at;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      while(line.length > 12 && ctx.measureText(line).width > cellW){ line = line.slice(0, -2); }
      if(line !== full) line = line.replace(/\s+\S*$/, "") + "…";
      ctx.fillText(line, cellX + cellW/2, cellY + plateH + credPx * 0.4);
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   Refresh
   ═══════════════════════════════════════════════════════════ */

async function refresh(){
  const token = ++busy;
  syncExportState();
  if(!selected.length){
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
    if(tainted){
      note("This browser wouldn't let the page read Wikimedia's images back, so export is unavailable. Serving the file over http://localhost rather than opening it directly usually fixes it.", true);
    }
    renderSources();
  } catch (e) {
    note("Couldn't draw the sheet: " + cleanText(e && e.message, 80), true);
  } finally {
    if(token === busy) progress(null);
    syncExportState();
  }
}

function specRowsForSheet(){
  if(!spec) return [];
  return spec.rows.filter(r => SHEET_FIELDS.includes(r.key));
}

function renderSpec(){
  const dl = $("specList");
  dl.replaceChildren();
  if(!spec){
    $("specNote").textContent = chosen
      ? "No infobox was found for this country, so nothing is claimed about its plate requirements."
      : "";
    $("spec").hidden = !chosen;
    return;
  }
  for(const r of spec.rows){
    const dt = document.createElement("dt"); dt.textContent = r.label;   // text, never markup
    const dd = document.createElement("dd"); dd.className = "plain"; dd.textContent = r.value;
    dl.append(dt, dd);
  }
  const front = spec.rows.find(r => r.key === "front plate");
  const rear  = spec.rows.find(r => r.key === "rear plate");
  $("specNote").textContent = (front || rear)
    ? "Shown exactly as the article records them."
    : "This article's infobox does not state whether front and rear plates are required — it is not stated rather than not required.";
  $("spec").hidden = false;
}

/* ═══════════════════════════════════════════════════════════
   Sources
   ═══════════════════════════════════════════════════════════ */

function renderSources(){
  const dl = $("sourceList");
  dl.replaceChildren();
  const row = (term, href, label) => {
    const dt = document.createElement("dt"); dt.textContent = term;
    const dd = document.createElement("dd");
    if(href){
      const a = document.createElement("a");
      a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.textContent = label;                       // text, never markup
      dd.append(a);
    } else { dd.textContent = label; }
    dl.append(dt, dd);
  };

  selected.forEach((rec, i) => {
    row(`Plate ${i + 1}`, rec.describeUrl || "", rec.describeUrl
      ? `${rec.licence.label}${rec.author ? " · " + rec.author : ""} — file page`
      : "no file page recorded");
  });
  if(chosen) row("Category searched", `https://commons.wikimedia.org/wiki/${encodeURIComponent(chosen.title)}`, chosen.title);
  if(sourceVia) row("Country list from", "", sourceVia);
  if(spec) row("Plate data read from", spec.url || "",
               `${spec.title} — English Wikipedia, CC BY-SA 4.0`);

  const sa = selected.filter(r => r.licence.shareAlike);
  $("caveat").textContent =
    "Licences are read from each file's Commons metadata, which is parsed free text rather than structured data, so check the file page before relying on it." +
    (sa.length ? ` ${sa.length} selected ${sa.length === 1 ? "image is" : "images are"} share-alike, which may oblige you to license the finished sheet the same way.` : "");
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

/*
  The categories this country's own files sit in, commonest first. A category
  holding a single file is no use as a filter.
*/
function renderCategoryFilter(){
  const counts = new Map();
  for(const rec of candidates)
    for(const c of rec.cats || []) counts.set(c, (counts.get(c) || 0) + 1);

  const list = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 120);

  const sel = $("catFilter");
  const previous = sel.value;
  sel.replaceChildren(
    new Option(`All categories${candidates.length ? " (" + candidates.length + ")" : ""}`, ""),
    ...list.map(([name, n]) => new Option(`${name} (${n})`, name)));
  sel.value = list.some(([name]) => name === previous) ? previous : "";
}

function renderGrid(){
  // Both filters narrow together: a category, and a name within it.
  const q = norm($("filter").value);
  const cat = $("catFilter").value;
  const list = candidates.filter(r =>
    licenceAllowed(r) &&
    (!cat || (r.cats || []).includes(cat)) &&
    (!q || (r.keywords || "").includes(q)));
  $("pickerCount").textContent =
    `${list.length} shown of ${candidates.length} found · ${selected.length} of ${MAX_SELECTED} chosen` +
    ((q || cat) && !list.length ? " · nothing matches both" : "");
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
    meta.append(lic);

    // The file name usually says whether a plate is current or historic, and a
    // year in it says so at a glance.
    const nameRow = document.createElement("div");
    nameRow.className = "row split";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = rec.title;                          // text, never markup
    name.title = rec.title;
    nameRow.append(name);
    if(rec.year){
      const year = document.createElement("span");
      year.className = "year";
      year.textContent = rec.year;
      year.title = "Year found in the file name — check the file page to be sure";
      nameRow.append(year);
    }
    meta.append(nameRow);

    const who = document.createElement("span");
    who.className = "who";
    who.textContent = rec.author || "author not stated";   // text, never markup
    meta.append(who);

    const row = document.createElement("div");
    row.className = "row";
    const sel = document.createElement("select");
    for(const id of SECTION_ORDER) sel.append(new Option(own(SECTION_LABEL, id), id));
    sel.value = rec.section;
    sel.addEventListener("change", () => { rec.section = sel.value; refresh(); });
    row.append(sel);

    const edit = document.createElement("button");
    edit.className = "edit"; edit.type = "button"; edit.textContent = "Blur";
    edit.addEventListener("click", () => openEditor(rec));
    row.append(edit);
    meta.append(row);

    if(rec.describeUrl){
      const foot = document.createElement("div");
      foot.className = "row split";
      const link = document.createElement("a");
      link.href = rec.describeUrl;
      link.target = "_blank"; link.rel = "noopener noreferrer";
      link.textContent = "File page";
      link.className = "filelink";
      link.title = "Open on Commons to check the date and description";
      foot.append(link);
      meta.append(foot);
    }

    tile.append(thumb, meta);
    return tile;
  }));
  $("picker").hidden = !candidates.length;
}

function toggleSelect(rec){
  const at = selected.indexOf(rec);
  if(at >= 0) selected.splice(at, 1);
  else if(selected.length >= MAX_SELECTED){
    note(`${MAX_SELECTED} plates is as many as fit on one sheet.`);
    return;
  } else {
    selected.push(rec);
    if(rec.licence.shareAlike && !shareAlikeWarned){
      shareAlikeWarned = true;
      note("That image is share-alike, which can oblige you to publish the finished sheet under the same licence. The licence filter can hide these if that's a problem.");
      renderGrid();
      refresh();
      return;
    }
  }
  note("");
  renderGrid();
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Blur region editor
   ═══════════════════════════════════════════════════════════ */

let drag = null;

async function openEditor(rec){
  editing = rec;
  $("editor").hidden = false;
  $("editTitle").textContent = "Blur regions";
  try {
    const img = await loadImage(rec.thumb);
    const c = $("editCanvas");
    const w = Math.min(760, img.naturalWidth || img.width);
    const scale = w / (img.naturalWidth || img.width);
    c.width = w;
    c.height = Math.round((img.naturalHeight || img.height) * scale);
    drawEditor();
  } catch (e) {
    note("Couldn't load that image for editing.", true);
    $("editor").hidden = true;
  }
}

function drawEditor(){
  if(!editing) return;
  const c = $("editCanvas"), ctx = c.getContext("2d");
  const img = imageCache.get(editing.thumb);
  if(!img) return;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  ctx.strokeStyle = "#f2c14e"; ctx.lineWidth = 2;
  ctx.fillStyle = "rgba(242,193,78,0.22)";
  for(const r of editing.regions){
    const x = r.x * c.width, y = r.y * c.height, w = r.w * c.width, h = r.h * c.height;
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  }
  if(drag){
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0);
    ctx.setLineDash([]);
  }
}

function editorPoint(e){
  const c = $("editCanvas");
  const box = c.getBoundingClientRect();
  return {
    x: clamp((e.clientX - box.left) / box.width, 0, 1) * c.width,
    y: clamp((e.clientY - box.top) / box.height, 0, 1) * c.height
  };
}

/* ═══════════════════════════════════════════════════════════
   Country picking
   ═══════════════════════════════════════════════════════════ */

let countryMatches = [], countryCursor = 0;
const norm = s => String(s).toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();

function searchCountries(q){
  const n = norm(q);
  if(!n) return [];
  const scored = [];
  for(const c of COUNTRIES){
    const forms = [c.name, c.official, ...(c.aliases || [])].filter(Boolean).map(bareName);
    const code = (c.code || "").toLowerCase();
    let score = -1;
    if(n.length === 2 && code === n) score = 0;               // an exact code wins
    else if(forms.includes(n)) score = 1;
    else if(forms.some(f => f.startsWith(n))) score = 2;
    else if(code.startsWith(n) && n.length <= 2) score = 3;
    else if(forms.some(f => f.includes(n))) score = 4;
    if(score >= 0) scored.push({c, score});
  }
  return scored.sort((a,b) => a.score - b.score ||
                     (a.c.official || a.c.name).localeCompare(b.c.official || b.c.name))
               .slice(0, 9).map(s => s.c);
}

function renderCountryResults(){
  $("countryResults").replaceChildren(...countryMatches.map((c, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.title = c.title;
    if(i === countryCursor) b.className = "on";
    if(c.code){
      const code = document.createElement("code");
      code.textContent = c.code;                     // text, never markup
      b.append(code);
    }
    const label = document.createElement("span");
    label.textContent = c.official || c.name;        // text, never markup
    b.append(label);
    return b;
  }));
}

async function pickCountry(c){
  if(!c) return;
  chosen = c;
  $("country").value = c.official || c.name;
  countryMatches = []; renderCountryResults();
  candidates = []; selected = []; editing = null; spec = null;
  $("editor").hidden = true;
  $("spec").hidden = true;
  $("grid").replaceChildren();
  note("");
  await refresh();

  progress("Asking Commons what it has", true);
  try {
    const subs = await subcategoriesOf(c.title, 60);
    const sources = [{title: c.title, label: c.title}, ...subs.map(t => ({title: t, label: t}))];

    const seen = new Set();
    const found = [];
    for(const src of sources){
      if(found.length >= MAX_FILES) break;
      let titles = [];
      try { titles = await filesIn(src.title, 200); } catch (e) { continue; }
      for(const t of titles){
        if(seen.has(t) || found.length >= MAX_FILES) continue;
        seen.add(t);
        found.push({title: t, from: src.label});
      }
    }
    if(!found.length){
      note("Commons lists no files in that category or its subcategories.", true);
      return;
    }

    progress(`Reading licences for ${found.length} files`, true);
    const infos = await fileInfo(found.map(f => f.title));
    const fromByTitle = new Map(found.map(f => ["File:" + f.title.replace(/^File:/, ""), f.from]));

    for(const rec of infos){
      rec.section = guessSection(rec.title, fromByTitle.get("File:" + rec.title) || "", rec.cats);
      rec.diagram = looksLikeDiagram(rec);
    }
    infos.sort((a, b) => (b.diagram ? 1 : 0) - (a.diagram ? 1 : 0) || a.title.localeCompare(b.title));
    candidates = infos;
    renderCategoryFilter();
    renderGrid();

    // Requirements are a bonus; a failure here must not lose the plates.
    progress("Looking up plate requirements", true);
    try {
      const article = await findArticle(c);
      spec = article ? await fetchInfobox(article) : null;
    } catch (e) { spec = null; }
    renderSpec();
    note(candidates.length >= MAX_FILES
      ? `Commons holds more than the ${MAX_FILES} files fetched, so this is the first part of its own ordering rather than a selection. Use the filters to find a particular plate.`
      : "");
  } catch (e) {
    note("Commons didn't answer: " + cleanText(e && e.message, 60) + ".", true);
  } finally {
    progress(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Export
   ═══════════════════════════════════════════════════════════ */

function syncExportState(){
  const ready = selected.length > 0 && !tainted;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("revealTag").hidden = !$("optCountry").checked;
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
    if(opts.country && chosen){
      slug = chosen.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    } else {
      let h = 0;
      const seed = selected.map(r => r.pageid || r.title).join("|");
      for(let i = 0; i < seed.length; i++) h = (h*31 + seed.charCodeAt(i)) >>> 0;
      slug = h.toString(36).slice(0, 6);
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `plates-${slug || "sheet"}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    note("");
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
  if(b) pickCountry(COUNTRIES.find(c => c.title === b.dataset.title));
});

$("catFilter").addEventListener("change", renderGrid);

let filterTimer;
$("filter").addEventListener("input", () => {
  clearTimeout(filterTimer); filterTimer = setTimeout(renderGrid, 150);
});

$("licFilter").addEventListener("change", () => {
  selected = selected.filter(licenceAllowed);
  renderGrid(); refresh();
});

$("blurWhole").addEventListener("click", () => { setSeg($("blurWhole"), $("blurRegions")); refresh(); });
$("blurRegions").addEventListener("click", () => { setSeg($("blurRegions"), $("blurWhole")); refresh(); });

let blurTimer;
$("blurAmount").addEventListener("input", e => {
  $("blurOut").textContent = (e.target.value / 10).toFixed(1) + "%";
  clearTimeout(blurTimer); blurTimer = setTimeout(refresh, 220);
});

$("frame").addEventListener("change", () => { $("customSize").hidden = $("frame").value !== "custom"; refresh(); });
let sizeTimer;
["customW","customH"].forEach(id => $(id).addEventListener("input", () => {
  clearTimeout(sizeTimer); sizeTimer = setTimeout(refresh, 400);
}));

["optSections","optCountry","optTransparent","optSpec"].forEach(id =>
  $(id).addEventListener("change", () => {
    if(id === "optSpec") $("specPosField").hidden = !$("optSpec").checked;
    syncExportState(); refresh();
  }));

let capTimer;
$("capText").addEventListener("input", () => {
  $("capPosField").hidden = !cleanText($("capText").value, 120);
$("specPosField").hidden = !$("optSpec").checked;
  clearTimeout(capTimer); capTimer = setTimeout(refresh, 300);
});
$("specTop").addEventListener("click", () => { setSeg($("specTop"), $("specBottom")); refresh(); });
$("specBottom").addEventListener("click", () => { setSeg($("specBottom"), $("specTop")); refresh(); });
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

/* editor pointer handling */
$("editCanvas").addEventListener("pointerdown", e => {
  if(!editing) return;
  const p = editorPoint(e);
  const c = $("editCanvas");
  // A click inside an existing box removes it.
  const hit = editing.regions.findIndex(r =>
    p.x >= r.x*c.width && p.x <= (r.x+r.w)*c.width &&
    p.y >= r.y*c.height && p.y <= (r.y+r.h)*c.height);
  if(hit >= 0){ editing.regions.splice(hit, 1); drawEditor(); refresh(); return; }
  drag = {x0: p.x, y0: p.y, x1: p.x, y1: p.y};
  c.setPointerCapture(e.pointerId);
});
$("editCanvas").addEventListener("pointermove", e => {
  if(!drag) return;
  const p = editorPoint(e);
  drag.x1 = p.x; drag.y1 = p.y;
  drawEditor();
});
$("editCanvas").addEventListener("pointerup", () => {
  if(!drag || !editing) { drag = null; return; }
  const c = $("editCanvas");
  const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
  const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
  drag = null;
  if(w > 6 && h > 6){
    editing.regions.push({x: x/c.width, y: y/c.height, w: w/c.width, h: h/c.height});
    setSeg($("blurRegions"), $("blurWhole"));
    refresh();
  }
  drawEditor();
});
$("editClear").addEventListener("click", () => {
  if(editing){ editing.regions = []; drawEditor(); refresh(); }
});
$("editClose").addEventListener("click", () => { editing = null; $("editor").hidden = true; });

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

$("capPosField").hidden = !cleanText($("capText").value, 120);
$("specPosField").hidden = !$("optSpec").checked;
syncExportState();
progress("Loading the country list from Commons", true);
loadCountries()
  .then(async ({list, via}) => {
    const seen = new Set();
    const sortKey = n => n.replace(/^the\s+/i, "");
    COUNTRIES = list.filter(c => !seen.has(c.name) && seen.add(c.name))
                    .sort((a,b) => sortKey(a.name).localeCompare(sortKey(b.name)));
    // Codes are an improvement, not a requirement.
    try { attachCodes(COUNTRIES, await loadTerritories()); }
    catch (e) { for(const c of COUNTRIES){ c.code = ""; c.official = ""; c.aliases = []; } }
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — name or code`;
    input.focus();
    progress(null);
    sourceVia = via;
  })
  .catch(err => {
    progress(null);
    const detail = Array.isArray(err && err.tried) && err.tried.length
      ? " Tried: " + err.tried.join("; ") + "."
      : "";
    note("Couldn't get a country list from Wikimedia Commons." + detail + " Reload to try again.", true);
  });
