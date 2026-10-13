/* ═══════════════════════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════════════════════ */

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

/*
  Commons names countries its own way — "the United States", "Czech
  Republic" — so CLDR supplies the standard English names and the ISO
  two-letter codes people actually type.
*/
const CLDR_VERSION = "47";
const URL_TERRITORIES =
  `https://cdn.jsdelivr.net/npm/cldr-localenames-full@${CLDR_VERSION}/main/en/territories.json`;
const NOT_A_COUNTRY = new Set(["EU","EZ","UN","QO","XA","XB","ZZ"]);

/* What people type that neither Commons nor CLDR lists. */
const ALIASES = {
  US: ["usa", "america", "united states of america"],
  GB: ["britain", "great britain", "england", "scotland", "wales"],
  NL: ["holland"],
  MM: ["burma"],
  SZ: ["swaziland"],
  CI: ["ivory coast"],
  TR: ["turkey"],
  CV: ["cape verde"],
  TL: ["east timor"],
  CD: ["drc", "congo kinshasa"],
  CG: ["congo brazzaville"],
  KR: ["south korea"],
  KP: ["north korea"],
  AE: ["uae"],
  CH: ["schweiz", "suisse"],
  DE: ["deutschland"],
  AT: ["osterreich"]
};
const UPLOAD_HOST = "upload.wikimedia.org";

/*
  New Zealand's regulatory SVGs alone run to 244 files. A small cap silently
  kept whichever ones Commons listed first, which is why its give-way sign
  never appeared: "R2-3" sorts too late to survive a cut at 26.
*/
const MAX_FILES    = 1800;
const MAX_PER_CLASS = 300;
const MAX_SELECTED = 16;
const THUMB_W      = 320;
const FULL_W       = 1000;
const MAX_PIXELS   = 32e6;

/*
  Commons keeps photographs under "Road signs IN X" and the official artwork
  under "Diagrams of road signs OF X". The artwork is what belongs on a sheet,
  so the country list comes from the diagrams tree.
*/
const ROOT_CATEGORY = "Category:Diagrams of road signs by country";
const NAME_PREFIX = "Diagrams of road signs of ";

/*
  Sign classes, in the order they read on a sheet.

  Countries do not agree on how to classify signs, and the categories follow
  that. Vienna Convention countries split regulation into prohibitory,
  mandatory and priority; the MUTCD countries — the United States, Australia,
  Canada, New Zealand and others — use a single "regulatory" class and have no
  category under the Vienna names at all. So most countries fill some of these
  and not others, and an empty class is the norm rather than a fault.
*/
const SECTIONS = [
  {id: "warning",     label: "Warning",     type: "warning"},
  {id: "regulatory",  label: "Regulatory",  type: "regulatory"},
  {id: "prohibitory", label: "Prohibitory", type: "prohibitory"},
  {id: "mandatory",   label: "Mandatory",   type: "mandatory"},
  {id: "priority",    label: "Priority",    type: "priority"},
  {id: "information", label: "Information", type: "information"}
];
const SECTION_ORDER = SECTIONS.map(s => s.id);
const SECTION_LABEL = Object.fromEntries(SECTIONS.map(s => [s.id, s.label]));

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
const cleanText = (raw, max) =>
  String(raw || "").replace(BIDI_AND_CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max || 120);

const norm = s => String(s).toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
const bareName = n => norm(String(n).replace(/^the\s+/i, ""));

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

async function commons(params){
  const p = new URLSearchParams({format: "json", formatversion: "2", origin: "*", ...params});
  const r = await fetch(COMMONS_API + "?" + p.toString());
  if(!r.ok){ const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
  const data = await r.json();
  if(data && data.error) throw new Error(String(data.error.code || "api error").slice(0, 60));
  return data;
}

/* ═══════════════════════════════════════════════════════════
   Categories
   ═══════════════════════════════════════════════════════════ */

async function subcategoriesOf(title, limit){
  const data = await commons({
    action: "query", list: "categorymembers", cmtitle: title,
    cmtype: "subcat", cmlimit: String(limit || 500)
  });
  return memberTitles(data);
}

/* The shape is checked rather than assumed: a malformed reply should give
   nothing, not a type error from deep inside a loop. */
function memberTitles(data){
  const rows = data && data.query && data.query.categorymembers;
  if(!Array.isArray(rows)) return [];
  return rows.map(r => r && typeof r.title === "string" ? r.title : "").filter(Boolean);
}

async function filesIn(title, limit){
  const data = await commons({
    action: "query", list: "categorymembers", cmtitle: title,
    cmtype: "file", cmlimit: String(limit || 500)
  });
  return memberTitles(data);
}

/*
  CLDR gives the standard English name and the ISO code for each territory,
  including the alternative names people type. Commons is matched against it
  by a normalised name with any leading "the" removed, so "the United States"
  and "United States" meet.
*/
async function loadTerritories(){
  const r = await fetch(URL_TERRITORIES);
  if(!r.ok) throw new Error("HTTP " + r.status);
  const data = await r.json();
  const t = data && data.main && data.main.en && data.main.en.localeDisplayNames
            && data.main.en.localeDisplayNames.territories;
  if(!t) throw new Error("unexpected territories data");

  const byCode = new Map();
  for(const key of Object.keys(t)){
    const value = own(t, key);
    if(typeof value !== "string") continue;
    const code = key.split("-")[0];
    if(!/^[A-Z]{2}$/.test(code) || NOT_A_COUNTRY.has(code)) continue;
    const entry = byCode.get(code) || {code, name: "", alts: []};
    if(key === code) entry.name = cleanText(value, 80);
    else entry.alts.push(cleanText(value, 80));
    byCode.set(code, entry);
  }
  const byName = new Map();
  for(const e of byCode.values()){
    if(!e.name) continue;
    for(const n of [e.name, ...e.alts]) byName.set(bareName(n), e);
  }
  return byName;
}

async function loadCountries(){
  const subs = await subcategoriesOf(ROOT_CATEGORY, 500);
  const out = [];
  for(const title of subs){
    const bare = title.replace(/^Category:/, "");
    if(!bare.toLowerCase().startsWith(NAME_PREFIX.toLowerCase())) continue;
    const name = cleanText(bare.slice(NAME_PREFIX.length), 90);
    // Qualified subcategories such as "… of Germany by number" are not countries.
    if(!name || /\s[-–—]\s|\sby\s|\s\(/i.test(name)) continue;
    out.push({title, name});
  }
  const seen = new Set();
  const list = out.filter(c => !seen.has(c.name) && seen.add(c.name));

  // A failure here costs the codes and the standard names, not the app.
  let byName = null;
  try { byName = await loadTerritories(); }
  catch (e) { byName = null; }

  for(const c of list){
    const hit = byName ? byName.get(bareName(c.name)) : null;
    c.code = hit ? hit.code : "";
    c.standard = hit ? hit.name : "";
    c.alts = hit ? hit.alts : [];
  }
  return list.sort((a,b) =>
    bareName(a.standard || a.name).localeCompare(bareName(b.standard || b.name)));
}

/*
  The country name is taken from Commons' own category title, so it already
  carries the definite article wherever Commons uses one — "the United
  States", "the Czech Republic". Only the form without it is worth adding;
  inventing "the Germany" would just waste a request on every sign class.
*/
function categoryCandidates(country, type){
  const c = country.name;
  const forms = [...new Set([c, c.replace(/^the\s+/i, "")])];
  const out = [];
  // SVG first: that tier holds the files, while the diagrams tier is often
  // nothing but subcategories.
  for(const f of forms) out.push(`Category:SVG ${type} road signs of ${f}`);
  for(const f of forms) out.push(`Category:Diagrams of ${type} road signs of ${f}`);
  return out;
}

/* ═══════════════════════════════════════════════════════════
   Files
   ═══════════════════════════════════════════════════════════ */

function safeImageUrl(u){
  try {
    const url = new URL(String(u));
    if(url.protocol !== "https:" || url.hostname !== UPLOAD_HOST) return null;
    return url.href;
  } catch (e) { return null; }
}

function firstSafeImageUrl(...candidates){
  for(const c of candidates){ const ok = safeImageUrl(c); if(ok) return ok; }
  return null;
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
  A sign whose name says it is historic or obsolete is a different puzzle,
  and a file with no citable page cannot be credited.
*/
const HISTORIC = /\b(historic|historical|obsolete|former|18\d\d|19[0-8]\d)\b/i;

function describeFile(page, info, section){
  if(typeof info.mime === "string" && !/^image\//.test(info.mime)) return null;
  const pageid = Number.isInteger(page.pageid) && page.pageid > 0 ? page.pageid : null;
  if(!pageid) return null;

  const thumb = firstSafeImageUrl(info.thumburl, info.url);
  if(!thumb) return null;

  const title = cleanText(String(page.title || "").replace(/^File:/, ""), 140);
  const ex = info.extmetadata || {};
  const val = k => { const f = own(ex, k); return f && typeof f.value === "string" ? f.value : ""; };

  /*
    Searchable text, never displayed: the file name plus the categories it
    sits in, so "give way" finds a sign whose name is only a code.
  */
  const rawCats = Array.isArray(page.categories) ? page.categories : [];
  const cats = rawCats.slice(0, 40)
    .map(c => cleanText(String(c && c.title || "").replace(/^Category:/, ""), 90))
    .filter(Boolean);
  const keywords = norm([title, ...cats].join(" "));

  return {
    title, pageid, thumb, keywords, cats,
    full: widenThumb(thumb, info.width) || thumb,
    author: htmlToText(val("Artist"), 70),
    licence: classifyLicence(htmlToText(val("LicenseShortName"), 40), val("LicenseUrl")),
    describeUrl: `https://commons.wikimedia.org/w/index.php?curid=${pageid}`,
    historic: HISTORIC.test(title),
    section
  };
}

async function fileInfo(titles, section){
  const out = [];
  for(let i = 0; i < titles.length; i += 50){
    // Categories come back in the same request, and they carry the words
    // people actually search for: a file named "R2-3" sits in "Give way
    // signs in New Zealand".
    const data = await commons({
      action: "query", prop: "imageinfo|categories", titles: titles.slice(i, i + 50).join("|"),
      iiprop: "url|extmetadata|size|mime", iiurlwidth: String(THUMB_W),
      cllimit: "500", clshow: "!hidden"
    });
    const pages = data && data.query && data.query.pages;
    for(const page of Array.isArray(pages) ? pages : []){
      const info = page && Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      if(!info) continue;
      const rec = describeFile(page, info, section);
      if(rec) out.push(rec);
    }
  }
  return out;
}

/*
  A sign class often holds subcategories rather than files — Germany's
  prohibitory diagrams are 36 subcategories and 5 loose files — so a thin
  result is followed one level down rather than accepted.
*/
async function titlesForSection(country, type, budget){
  const seen = new Set();
  const found = [];
  const push = t => { if(!seen.has(t) && found.length < budget){ seen.add(t); found.push(t); } };

  for(const cat of categoryCandidates(country, type)){
    if(found.length >= budget) break;
    let titles = [];
    try { titles = await filesIn(cat, 500); } catch (e) { continue; }
    titles.forEach(push);
    if(found.length >= 24) continue;         // plenty here; no need to go deeper

    let subs = [];
    try { subs = await subcategoriesOf(cat, 24); } catch (e) { subs = []; }
    for(const sub of subs.slice(0, 12)){
      if(found.length >= budget) break;
      try { (await filesIn(sub, 60)).forEach(push); } catch (e) { /* skip */ }
    }
  }
  return found;
}

/* ═══════════════════════════════════════════════════════════
   Blurring, for the signs that carry words
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

let filterSupport = null;
function supportsCanvasFilter(){
  if(filterSupport !== null) return filterSupport;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.filter = "blur(2px)";
  filterSupport = ctx.filter === "blur(2px)";
  return filterSupport;
}

/*
  Blur reads from a separate copy: a canvas drawn onto itself through a filter
  is read while it is being written, and only part of the image comes out.
*/
function blurInto(dest, src, radius){
  const ctx = dest.getContext("2d");
  if(dest === src) throw new Error("blurInto needs a separate source canvas");
  const w = dest.width, h = dest.height;
  if(radius <= 0.5){ ctx.drawImage(src, 0, 0, w, h); return; }

  if(supportsCanvasFilter()){
    ctx.save();
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(src, 0, 0, w, h);
    ctx.restore();
    return;
  }
  const f = Math.max(2, Math.round(radius));
  const tw = Math.max(1, Math.round(w / f)), th = Math.max(1, Math.round(h / f));
  const small = document.createElement("canvas");
  small.width = tw; small.height = th;
  const sctx = small.getContext("2d");
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(src, 0, 0, tw, th);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, w, h);
}

function renderSign(img, opts){
  const w = Math.max(1, img.naturalWidth || img.width);
  const h = Math.max(1, img.naturalHeight || img.height);
  const base = document.createElement("canvas");
  base.width = w; base.height = h;
  base.getContext("2d").drawImage(img, 0, 0, w, h);

  const radius = (opts.blurAmount / 1000) * w;
  if(!opts.blur || radius <= 0.5) return base;

  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  blurInto(out, base, radius);
  return out;
}

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

let COUNTRIES = [], chosen = null;
let candidates = [], selected = [];
let busy = 0, missingSections = [], foundSections = [], truncated = [];

function progress(label, pending){
  const bar = $("bar");
  if(label === null){ bar.style.display = "none"; bar.classList.remove("pending"); $("loadLabel").textContent = ""; return; }
  bar.style.display = "block";
  bar.classList.toggle("pending", !!pending);
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
    fg: safeColour($("fgColor").value, "#eceff4"),
    bg: safeColour($("bgColor").value, "#14171c"),
    at: safeColour($("atColor").value, "#8e97a6"),
    transparent: $("optTransparent").checked,
    sections: $("optSections").checked,
    country: $("optCountry").checked,
    blur: $("optBlur").checked,
    blurAmount: clamp(+$("blurAmount").value, 0, 150),
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
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let px = capPx;
    ctx.font = `600 ${px}px "Barlow Condensed", sans-serif`;
    while(px > 14 && ctx.measureText(opts.caption).width > W - pad*2){
      px -= 2; ctx.font = `600 ${px}px "Barlow Condensed", sans-serif`;
    }
    if(opts.capTop){ ctx.fillText(opts.caption, W/2, top + px*0.6); top += px * 1.9; }
    else           { ctx.fillText(opts.caption, W/2, bottom - px*0.6); bottom -= px * 1.9; }
  }

  if(opts.country && chosen){
    const px = Math.round(H * 0.030);
    ctx.font = `500 ${px}px "Barlow", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.72;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(chosen.standard || chosen.name, W/2, bottom - px*0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  const groups = SECTION_ORDER
    .map(id => ({id, items: selected.filter(s => s.section === id)}))
    .filter(g => g.items.length);
  if(!groups.length) return;

  const prepared = new Map();
  for(const rec of groups.flatMap(g => g.items)){
    let img;
    try { img = await loadImage(rec.full); }
    catch (e) {
      try { img = await loadImage(rec.thumb); }
      catch (e2) { continue; }
    }
    prepared.set(rec, renderSign(img, opts));
  }

  const bandH = (bottom - top) / groups.length;
  for(let gi = 0; gi < groups.length; gi++){
    const g = groups[gi];
    const items = g.items.filter(r => prepared.has(r));
    if(!items.length) continue;
    const bandTop = top + gi * bandH;
    let y = bandTop;

    if(opts.sections){
      const hPx = clamp(Math.round(bandH * 0.14), 15, 46);
      ctx.font = `600 ${hPx}px "Barlow Condensed", sans-serif`;
      ctx.fillStyle = opts.fg;
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = 0.78;
      ctx.fillText((own(SECTION_LABEL, g.id) || "Signs").toUpperCase(), pad, y + hPx);
      ctx.globalAlpha = 1;
      y += hPx * 1.7;
    }
    drawGrid(ctx, items, prepared, pad, y, W - pad*2, bandTop + bandH - y - bandH*0.05, opts);
  }
}

/* The column count that makes the smallest sign as large as possible. */
function chooseGrid(items, prepared, w, h, gap, needsCredit){
  const K = items.length;
  let best = null;
  for(let cols = 1; cols <= K; cols++){
    const rows = Math.ceil(K / cols);
    const cellW = (w - gap * (cols - 1)) / cols;
    const cellH = (h - gap * (rows - 1)) / rows;
    if(cellW <= 4 || cellH <= 4) continue;
    const credPx = needsCredit ? clamp(Math.round(cellH * 0.13), 9, 18) : 0;
    const signH = cellH - (credPx ? credPx * 2.0 : 0);
    if(signH <= 4) continue;
    let worst = Infinity;
    for(const rec of items){
      const p = prepared.get(rec);
      if(!p || !p.width || !p.height) continue;
      worst = Math.min(worst, Math.min(cellW / p.width, signH / p.height));
    }
    if(!Number.isFinite(worst)) continue;
    if(!best || worst > best.worst) best = {worst, cols, rows, cellW, cellH, credPx, signH};
  }
  return best;
}

function drawGrid(ctx, items, prepared, x, y, w, h, opts){
  if(!items.length || h <= 10 || w <= 10) return;
  const needsCredit = items.some(r => r.licence.attribution);
  const gap = Math.max(6, Math.round(Math.min(w, h) * 0.03));
  const best = chooseGrid(items, prepared, w, h, gap, needsCredit);
  if(!best) return;

  const {cols, cellW, cellH, credPx, signH} = best;
  const gridH = best.rows * cellH + gap * (best.rows - 1);
  const yTop = y + Math.max(0, (h - gridH) / 2);

  items.forEach((rec, i) => {
    const sign = prepared.get(rec);
    if(!sign) return;
    const r = Math.floor(i / cols), c = i % cols;
    const inRow = Math.min(cols, items.length - r * cols);
    const rowW = inRow * cellW + gap * (inRow - 1);
    const cellX = x + (w - rowW) / 2 + c * (cellW + gap);
    const cellY = yTop + r * (cellH + gap);

    const scale = Math.min(cellW / sign.width, signH / sign.height);
    const dw = Math.max(1, Math.round(sign.width * scale));
    const dh = Math.max(1, Math.round(sign.height * scale));
    ctx.drawImage(sign,
      Math.round(cellX + (cellW - dw) / 2),
      Math.round(cellY + (signH - dh) / 2), dw, dh);

    if(credPx && rec.licence.attribution){
      // The credit names the author and a permalink, never the file title:
      // the title usually says which country this is.
      const bits = [rec.author ? rec.author : "Wikimedia Commons",
                    rec.licence.label,
                    rec.describeUrl.replace(/^https:\/\//, "")].filter(Boolean);
      const full = bits.join(" · ");
      let line = full;
      ctx.font = `400 ${credPx}px "Barlow", sans-serif`;
      ctx.fillStyle = opts.at;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      while(line.length > 12 && ctx.measureText(line).width > cellW){ line = line.slice(0, -2); }
      if(line !== full) line = line.replace(/\s+\S*$/, "") + "…";
      ctx.fillText(line, cellX + cellW/2, cellY + signH + credPx * 0.4);
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   Panels
   ═══════════════════════════════════════════════════════════ */

function licenceAllowed(rec){
  const mode = $("licFilter").value;
  if(mode === "all") return true;
  if(mode === "pd") return rec.licence.id === "pd";
  return rec.licence.id === "pd" || rec.licence.id === "by";
}

/*
  The categories the country's own files sit in, commonest first. This is
  Commons' own classification rather than anything invented here, so it is
  the most reliable way to find, say, every roundabout sign.
*/
function renderCategoryFilter(){
  const counts = new Map();
  for(const rec of candidates)
    for(const c of rec.cats || []) counts.set(c, (counts.get(c) || 0) + 1);

  const list = [...counts.entries()]
    .filter(([, n]) => n >= 2)               // a category of one is no filter
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 120);

  const sel = $("catFilter");
  const previous = sel.value;
  sel.replaceChildren(
    new Option(`All categories${candidates.length ? " (" + candidates.length + ")" : ""}`, ""),
    ...list.map(([name, n]) => new Option(`${name} (${n})`, name)));
  // Keep the chosen category across a redraw when it still exists.
  sel.value = list.some(([name]) => name === previous) ? previous : "";
}

function renderGrid(){
  /*
    The file name is not printed on a tile — "New Zealand road sign R2-3"
    would give the country away — but it is still what the filter matches, so
    a specific sign can be found among hundreds.
  */
  const q = norm($("filter").value);
  const cat = $("catFilter").value;
  // Both filters narrow together: a category, and a name within it.
  const list = candidates.filter(r =>
    licenceAllowed(r) &&
    (!cat || (r.cats || []).includes(cat)) &&
    (!q || (r.keywords || "").includes(q)));
  $("pickerCount").textContent =
    `${list.length} shown of ${candidates.length} found · ${selected.length} of ${MAX_SELECTED} chosen` +
    ((q || cat) && !list.length ? " · nothing matches both" : "");

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

    const foot = document.createElement("div");
    foot.className = "row";
    const sel = document.createElement("select");
    for(const id of SECTION_ORDER) sel.append(new Option(own(SECTION_LABEL, id), id));
    sel.value = rec.section;
    sel.addEventListener("change", () => { rec.section = sel.value; renderGrid(); refresh(); });
    const link = document.createElement("a");
    link.href = rec.describeUrl;
    link.target = "_blank"; link.rel = "noopener noreferrer";
    link.textContent = "File page";
    link.className = "filelink";
    link.title = "Open on Commons to check what this sign means";
    foot.append(sel, link);

    meta.append(lic, foot);
    tile.append(thumb, meta);
    return tile;
  }));
  $("picker").hidden = !candidates.length;
}

function toggleSelect(rec){
  const at = selected.indexOf(rec);
  if(at >= 0) selected.splice(at, 1);
  else if(selected.length >= MAX_SELECTED){
    note(`${MAX_SELECTED} signs is as many as fit on one sheet.`);
    return;
  } else selected.push(rec);
  note("");
  renderGrid();
  refresh();
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
      a.textContent = label;                       // text, never markup
      dd.append(a);
    } else dd.textContent = label;
    dl.append(dt, dd);
  };

  selected.forEach((rec, i) => {
    row(`Sign ${i + 1}`, rec.describeUrl,
        `${rec.licence.label}${rec.author ? " · " + rec.author : ""} — file page`);
  });

  const caveats = [
    "Sign artwork comes from Wikimedia Commons. Licences are read from each file's metadata, which is free text rather than structured data, so open a file page if you need to be sure. Attribution is drawn on the sheet for images whose licence asks for it."
  ];
  if(missingSections.length)
    caveats.push(`Commons has no ${missingSections.join(", ")} category for this country. ` +
      "Sign classes are not shared across conventions — a country following the Vienna Convention " +
      "splits regulation into prohibitory, mandatory and priority signs, while one following the " +
      "MUTCD has a single regulatory class — so an absent class usually reflects which system the " +
      "country uses rather than a gap in the data.");
  if(truncated.length)
    caveats.push(`The ${truncated.join(" and ")} categories hold more than the ${MAX_PER_CLASS} signs fetched, so what is shown is the first part of Commons' own ordering rather than a selection.`);
  if(candidates.some(r => r.historic))
    caveats.push("Some files name themselves as historic or obsolete; those are marked in the picker and are a different puzzle from the signs in use today.");
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !selected.length;
}

/* ═══════════════════════════════════════════════════════════
   Country picking
   ═══════════════════════════════════════════════════════════ */

let matches = [], cursor = 0;

function searchCountries(q){
  const n = norm(q);
  if(!n) return [];
  const scored = [];
  for(const c of COUNTRIES){
    const forms = [c.name, c.standard, ...(c.alts || []),
                   ...(own(ALIASES, c.code) || [])].filter(Boolean).map(bareName);
    const code = (c.code || "").toLowerCase();
    let score = -1;
    if(n.length === 2 && code === n) score = 0;      // an exact code wins
    else if(forms.includes(n)) score = 1;
    else if(forms.some(f => f.startsWith(n))) score = 2;
    else if(code.startsWith(n) && n.length <= 2) score = 3;
    else if(forms.some(f => f.includes(n))) score = 4;
    if(score >= 0) scored.push({c, score});
  }
  return scored.sort((a,b) => a.score - b.score ||
      (a.c.standard || a.c.name).localeCompare(b.c.standard || b.c.name))
    .slice(0, 9).map(s => s.c);
}

function renderResults(){
  $("countryResults").replaceChildren(...matches.map((c, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.name = c.name;
    if(i === cursor) b.className = "on";
    if(c.code){
      const code = document.createElement("code");
      code.textContent = c.code;                   // text, never markup
      b.append(code);
    }
    const label = document.createElement("span");
    label.textContent = c.standard || c.name;      // text, never markup
    b.append(label);
    return b;
  }));
}

async function pickCountry(c){
  if(!c) return;
  chosen = c;
  $("country").value = c.standard || c.name;
  matches = []; renderResults();
  candidates = []; selected = []; missingSections = []; foundSections = []; truncated = [];
  $("grid").replaceChildren();
  note("");
  refresh();

  try {
    const perSection = clamp(Math.floor(MAX_FILES / SECTIONS.length), 8, MAX_PER_CLASS);
    truncated = [];
    const all = [];
    const seenTitles = new Set();
    const seenIds = new Set();
    foundSections = [];

    for(const section of SECTIONS){
      progress(`Looking for ${section.label.toLowerCase()} signs`, true);
      let titles = [];
      try { titles = await titlesForSection(c, section.type, perSection); }
      catch (e) { titles = []; }
      // A Vienna country files the same sign under regulatory and prohibitory;
      // it belongs on the sheet once.
      titles = titles.filter(t => !seenTitles.has(t) && seenTitles.add(t));
      if(!titles.length){ missingSections.push(section.label.toLowerCase()); continue; }
      // A class holding more than the cap is reported, not silently shortened.
      if(titles.length >= perSection) truncated.push(section.label.toLowerCase());

      progress(`Reading ${titles.length} ${section.label.toLowerCase()} signs`, true);
      let recs = [];
      try { recs = await fileInfo(titles, section.id); } catch (e) { recs = []; }
      recs = recs.filter(r => !seenIds.has(r.pageid) && seenIds.add(r.pageid));
      if(recs.length) foundSections.push(section.label);
      all.push(...recs);
    }
    candidates = all;
    renderCategoryFilter();
    if(!candidates.length)
      note("Commons has no sign artwork in the categories tried for this country.", true);
    else
      // Which classes exist says something real about the country; which are
      // absent usually says only which convention it follows.
      note(`Found ${candidates.length} signs in ${foundSections.length} ` +
           `${foundSections.length === 1 ? "class" : "classes"}: ${foundSections.join(", ")}.` +
           (truncated.length
             ? ` Commons holds more ${truncated.join(" and ")} signs than fit here; use the filter to find a particular one.`
             : ""));
    renderGrid();
  } catch (e) {
    note("Commons didn't answer: " + cleanText(e && e.message, 60) + ".", true);
  } finally {
    progress(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
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
  const ready = selected.length > 0 && !tainted;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("revealTag").hidden = !$("optCountry").checked;
  $("blurField").hidden = !$("optBlur").checked;
  $("blurOut").textContent = (clamp(+$("blurAmount").value, 0, 150) / 10).toFixed(1) + "%";
  $("textWarning").textContent = selected.length
    ? "Many signs carry words — STOP, ARRÊT, 止まれ — and the language gives the country away. Blur those, or choose pictograms."
    : "";
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
      slug = (chosen.standard || chosen.name).toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    } else {
      let h = 0;
      const seed = selected.map(r => r.pageid).join("|");
      for(let i = 0; i < seed.length; i++) h = (h*31 + seed.charCodeAt(i)) >>> 0;
      slug = h.toString(36).slice(0, 6);
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `signs-${slug || "sheet"}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
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
  matches = searchCountries(e.target.value); cursor = 0; renderResults();
});
$("country").addEventListener("keydown", e => {
  if(!matches.length) return;
  if(e.key === "ArrowDown"){ cursor = (cursor+1) % matches.length; renderResults(); e.preventDefault(); }
  if(e.key === "ArrowUp"){ cursor = (cursor-1+matches.length) % matches.length; renderResults(); e.preventDefault(); }
  if(e.key === "Enter"){ pickCountry(matches[cursor]); e.preventDefault(); }
  if(e.key === "Escape"){ matches = []; renderResults(); }
});
$("countryResults").addEventListener("click", e => {
  const b = e.target.closest("button");
  if(b) pickCountry(COUNTRIES.find(c => c.name === b.dataset.name));
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

$("frame").addEventListener("change", () => { $("customSize").hidden = $("frame").value !== "custom"; refresh(); });
let sizeTimer;
["customW","customH"].forEach(id => $(id).addEventListener("input", () => {
  clearTimeout(sizeTimer); sizeTimer = setTimeout(refresh, 400);
}));

["optSections","optCountry","optTransparent","optBlur"].forEach(id =>
  $(id).addEventListener("change", () => { syncExportState(); refresh(); }));

let blurTimer;
$("blurAmount").addEventListener("input", () => {
  syncExportState();
  clearTimeout(blurTimer); blurTimer = setTimeout(refresh, 220);
});

let capTimer;
$("capText").addEventListener("input", () => {
  $("capPosField").hidden = !cleanText($("capText").value, 120);
  clearTimeout(capTimer); capTimer = setTimeout(refresh, 300);
});
function setSeg(on, off){
  on.setAttribute("aria-pressed", "true");
  off.setAttribute("aria-pressed", "false");
}
$("capTop").addEventListener("click", () => { setSeg($("capTop"), $("capBottom")); refresh(); });
$("capBottom").addEventListener("click", () => { setSeg($("capBottom"), $("capTop")); refresh(); });

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
progress("Loading the country list from Commons", true);
loadCountries()
  .then(list => {
    COUNTRIES = list;
    if(!COUNTRIES.length) throw new Error("no countries returned");
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — start typing`;
    input.focus();
    progress(null);
  })
  .catch(err => {
    progress(null);
    note("Couldn't get a country list from Wikimedia Commons: " +
         cleanText(err && err.message, 70) + ". Reload to try again.", true);
  });
