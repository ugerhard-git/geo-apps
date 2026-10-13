/* ═══════════════════════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════════════════════ */

const CDN = "https://cdn.jsdelivr.net/npm";
const CLDR_VERSION = "47";
const URL_TERRITORIES = `${CDN}/cldr-localenames-full@${CLDR_VERSION}/main/en/territories.json`;
const WDQS = "https://query.wikidata.org/sparql";

const MAX_PIXELS = 32e6;
const NOT_A_COUNTRY = new Set(["EU","EZ","UN","QO","XA","XB","ZZ"]);

const PALETTES = [
  {id: "okabe", name: "Okabe–Ito (colour-blind safe)",
   colours: ["#0072b2","#e69f00","#009e73","#cc79a7","#56b4e9","#d55e00","#8a6d3b","#4d4d4d"]},
  {id: "earth", name: "Muted earth",
   colours: ["#7a6a53","#a8894c","#5f7a6a","#9c5f4e","#7c7f93","#b09a6b","#4f5d63","#8d8378"]},
  {id: "bright", name: "High contrast",
   colours: ["#c62828","#2e7d32","#ef6c00","#1565c0","#6a1b9a","#00838f","#ad1457","#4e342e"]},
  {id: "mono", name: "Single hue (prints grey)",
   colours: ["#12333a","#1d4b54","#2a656f","#3c808a","#5a9aa2","#7fb4ba","#a8cdd1","#cde3e5"]}
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
const cleanText = (raw, max) =>
  String(raw || "").replace(BIDI_AND_CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max || 120);

const norm = s => String(s).toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
const bareName = n => norm(String(n).replace(/^the\s+/i, ""));

async function getJson(url){
  const r = await fetch(url);
  if(!r.ok){ const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
  return r.json();
}

/* A small deterministic generator, so a shuffle can be reproduced and a
   redraw never reshuffles behind your back. */
function rng(seed){
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/* ═══════════════════════════════════════════════════════════
   Countries
   ═══════════════════════════════════════════════════════════ */

let COUNTRIES = [];

async function loadCountries(){
  const terr = await getJson(URL_TERRITORIES);
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
  if(!COUNTRIES.length) throw new Error("no countries returned");
}

/* ═══════════════════════════════════════════════════════════
   Wikidata

   First-level divisions come from the country's own "contains administrative
   territorial entity" statements, skipping any that have been superseded.
   Wikidata's idea of a first level is its own: the United Kingdom gives four
   countries, and the United States includes the federal district and the
   territories alongside the fifty states.
   ═══════════════════════════════════════════════════════════ */

const ISO2 = /^[A-Z]{2}$/;

/*
  Area on Wikidata carries whatever unit the editor used, so the raw number
  means nothing on its own. These are converted to square kilometres. A value
  in a unit not listed here counts as no value at all, which — since a measure
  is only offered when every division has one — withdraws area for that
  country rather than showing one region under the wrong unit.
*/
const AREA_UNITS = {
  Q712226: 1,            // square kilometre
  Q25343: 1e-6,          // square metre
  Q232291: 2.589988,     // square mile
  Q35852: 0.01,          // hectare
  Q2737347: 0.0001,      // are
  Q81292: 0.00404686     // acre
};
const AREA_UNIT_NAME = "square kilometres";

function subdivisionQuery(iso2){
  return `SELECT ?sub ?subLabel ?population ?area WHERE {
  ?country wdt:P297 "${iso2}" .
  ?country p:P150 ?statement .
  ?statement ps:P150 ?sub .
  FILTER NOT EXISTS { ?statement pq:P582 ?ended }
  OPTIONAL { ?sub wdt:P1082 ?population }
  OPTIONAL {
    ?sub p:P2046/psv:P2046 [ wikibase:quantityAmount ?area ; wikibase:quantityUnit ?areaUnit ]
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
LIMIT 400`;
}

async function loadSubdivisions(iso2){
  if(!ISO2.test(iso2)) return [];
  const url = WDQS + "?format=json&query=" + encodeURIComponent(subdivisionQuery(iso2));
  const data = await getJson(url);
  const rows = (data && data.results && data.results.bindings) || [];

  const byId = new Map();
  for(const row of rows){
    const uri = row.sub && typeof row.sub.value === "string" ? row.sub.value : "";
    const id = /\/(Q\d+)$/.exec(uri);
    if(!id) continue;
    const label = cleanText(row.subLabel && row.subLabel.value, 60);
    // A missing English label comes back as the bare Q-number; that is not a name.
    if(!label || /^Q\d+$/.test(label)) continue;

    const num = k => {
      const v = row[k] && row[k].value;
      const n = v === undefined ? NaN : parseFloat(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    // Convert the area into one unit, or drop it if the unit is unfamiliar.
    let area = num("area");
    if(area !== null){
      const unitUri = row.areaUnit && typeof row.areaUnit.value === "string" ? row.areaUnit.value : "";
      const unitId = (/\/(Q\d+)$/.exec(unitUri) || [])[1] || "";
      const factor = own(AREA_UNITS, unitId);
      area = typeof factor === "number" ? area * factor : null;
    }
    const existing = byId.get(id[1]);
    const rec = {
      id: id[1], name: label,
      population: num("population"), area,
      url: "https://www.wikidata.org/wiki/" + id[1]
    };
    // Several statements can name the same entity; keep the fullest.
    if(!existing) byId.set(id[1], rec);
    else {
      existing.population = existing.population || rec.population;
      existing.area = existing.area || rec.area;
    }
  }
  return [...byId.values()].sort((a,b) => a.name.localeCompare(b.name));
}

/* ═══════════════════════════════════════════════════════════
   Repeated words in names

   Egypt's divisions all end in "Governorate", Nigeria's in "State", Russia's
   in "Oblast" — a word that eats most of the tag while saying nothing. Some
   countries carry it as a prefix instead: "Province of Buenos Aires".
   ═══════════════════════════════════════════════════════════ */

const AFFIX_SHARE = 0.6;      // how many names must agree before it counts
const AFFIX_MIN = 3;          // and how many names there must be at all
const CONNECTORS = new Set(["of","de","del","da","du","des","della","di","the","d"]);

const wordsOf = n => String(n).trim().split(/\s+/).filter(Boolean);

function tally(names, k, fromEnd){
  const counts = new Map();
  for(const n of names){
    const w = wordsOf(n);
    if(w.length <= k) continue;                 // never swallow the whole name
    const part = fromEnd ? w.slice(w.length - k) : w.slice(0, k);
    const key = part.join(" ").toLowerCase();
    const got = counts.get(key) || {text: part.join(" "), count: 0};
    got.count++;
    counts.set(key, got);
  }
  let best = null;
  for(const v of counts.values()) if(!best || v.count > best.count) best = v;
  return best;
}

/* The longest repeated run wins, so "Autonomous Region" beats "Region". */
function detectAffix(names){
  if(!Array.isArray(names) || names.length < AFFIX_MIN) return null;
  const need = Math.max(AFFIX_MIN, Math.ceil(names.length * AFFIX_SHARE));
  let best = null;
  for(const fromEnd of [true, false]){
    for(let k = 3; k >= 1; k--){
      const got = tally(names, k, fromEnd);
      if(!got || got.count < need) continue;
      const cand = {kind: fromEnd ? "suffix" : "prefix", text: got.text, words: k, count: got.count};
      if(!best || cand.words > best.words || (cand.words === best.words && cand.count > best.count))
        best = cand;
      break;                                    // longest run for this side
    }
  }
  return best;
}

function stripAffix(name, affix){
  if(!affix) return name;
  const w = wordsOf(name);
  if(w.length <= affix.words) return name;      // would leave nothing behind
  const part = (affix.kind === "suffix" ? w.slice(w.length - affix.words) : w.slice(0, affix.words))
    .join(" ").toLowerCase();
  if(part !== affix.text.toLowerCase()) return name;

  let rest = affix.kind === "suffix" ? w.slice(0, w.length - affix.words) : w.slice(affix.words);
  // "Province of Buenos Aires" leaves a dangling "of"; so does the reverse.
  while(rest.length > 1 && CONNECTORS.has(rest[affix.kind === "suffix" ? rest.length - 1 : 0].toLowerCase()))
    rest = affix.kind === "suffix" ? rest.slice(0, -1) : rest.slice(1);
  const out = rest.join(" ").replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
  return out || name;
}

/*
  Shortening must not make two regions look like the same one, so any name
  that would collide keeps its full form.
*/
function applyAffix(names, affix){
  if(!affix) return names.map(n => n);
  const stripped = names.map(n => stripAffix(n, affix));
  const seen = new Map();
  for(const s of stripped) seen.set(s.toLowerCase(), (seen.get(s.toLowerCase()) || 0) + 1);
  return stripped.map((s, i) => seen.get(s.toLowerCase()) > 1 ? names[i] : s);
}

/* ═══════════════════════════════════════════════════════════
   Sizing

   Logarithmic, so a region twenty times another's size reads as bigger
   without making the smaller one invisible. Sizes are relative to the
   subdivisions actually chosen, not the whole country.
   ═══════════════════════════════════════════════════════════ */

function relativeSizes(values){
  const n = values.length;
  if(!n) return [];
  let lo = Infinity, hi = -Infinity;
  for(const v of values){ if(v < lo) lo = v; if(v > hi) hi = v; }
  // Every region the same size, or only one: no spread to map.
  if(!(hi > lo)) return values.map(() => 0.65);
  const logLo = Math.log(lo), logHi = Math.log(hi);
  return values.map(v => 0.35 + 0.65 * ((Math.log(v) - logLo) / (logHi - logLo)));
}

/* ═══════════════════════════════════════════════════════════
   Laying the cloud out
   ═══════════════════════════════════════════════════════════ */

function tagFont(px){ return `700 ${Math.max(1, Math.round(px))}px "Fraunces", Georgia, serif`; }

function measureTags(ctx, tags, scale){
  return tags.map(t => {
    ctx.font = tagFont(t.rel * scale);
    const w = ctx.measureText(t.text).width;
    const h = t.rel * scale * 1.02;
    return {...t, px: t.rel * scale, w: t.rotated ? h : w, h: t.rotated ? w : h,
            textW: w, textH: h};
  });
}

/* Greedy lines, centred — the classic cloud shape. */
function layoutWrapped(ctx, tags, w, h, scale){
  const sized = measureTags(ctx, tags.map(t => ({...t, rotated: false})), scale);
  const gap = scale * 0.12;
  const lines = [];
  let line = [], lineW = 0;
  for(const t of sized){
    const add = t.w + (line.length ? gap : 0);
    if(line.length && lineW + add > w){ lines.push({items: line, w: lineW}); line = []; lineW = 0; }
    line.push(t);
    lineW += t.w + (line.length > 1 ? gap : 0);
  }
  if(line.length) lines.push({items: line, w: lineW});

  const lineHeights = lines.map(l => l.items.reduce((m, t) => Math.max(m, t.h), 0));
  const totalH = lineHeights.reduce((s, x) => s + x * 1.18, 0);
  if(totalH > h) return null;
  if(lines.some(l => l.w > w)) return null;

  const placed = [];
  let y = (h - totalH) / 2;
  lines.forEach((l, i) => {
    let x = (w - l.w) / 2;
    for(const t of l.items){
      placed.push({...t, x: x + t.w / 2, y: y + lineHeights[i] / 2});
      x += t.w + gap;
    }
    y += lineHeights[i] * 1.18;
  });
  return placed;
}

/* Largest first at the centre, then outwards along a spiral until each fits. */
function layoutSpiral(ctx, tags, w, h, scale, allowRotate){
  const order = tags.slice().sort((a, b) => b.rel - a.rel);
  const sized = measureTags(ctx, order.map((t, i) => ({
    ...t, rotated: allowRotate && i % 3 === 1
  })), scale);

  const placed = [];
  const pad = scale * 0.08;
  const fits = (x, y, t) => {
    if(x - t.w/2 < 0 || x + t.w/2 > w || y - t.h/2 < 0 || y + t.h/2 > h) return false;
    return !placed.some(p =>
      Math.abs(p.x - x) < (p.w + t.w) / 2 + pad &&
      Math.abs(p.y - y) < (p.h + t.h) / 2 + pad);
  };

  for(const t of sized){
    let done = false;
    const step = Math.max(2, scale * 0.06);
    for(let a = 0; a < 220 && !done; a += 0.35){
      const r = step * a * 0.55;
      const x = w/2 + r * Math.cos(a) * 1.35;   // wider than tall, like the frame
      const y = h/2 + r * Math.sin(a) * 0.75;
      if(fits(x, y, t)){ placed.push({...t, x, y}); done = true; }
    }
    if(!done) return null;
  }
  return placed;
}

/*
  Find the largest scale at which the whole cloud still fits, so a handful of
  regions fills the frame just as a full set does.
*/
function fitCloud(ctx, tags, w, h, mode, allowRotate){
  const run = s => mode === "spiral"
    ? layoutSpiral(ctx, tags, w, h, s, allowRotate)
    : layoutWrapped(ctx, tags, w, h, s);

  let lo = 8, hi = Math.max(12, h);
  let best = null;
  for(let i = 0; i < 18; i++){
    const mid = (lo + hi) / 2;
    const got = run(mid);
    if(got){ best = got; lo = mid; } else hi = mid;
  }
  return best || run(8);
}

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

let chosen = null;
let subdivisions = [];       // everything Wikidata returned
let usable = [];             // those with the chosen metric
let picked = [];             // the current random selection
let affix = null;            // a word every name repeats, if there is one
let weighted = true;         // whether a complete measure exists to size by
let seed = 1;
let busy = 0;

const metric = () => $("byArea").getAttribute("aria-pressed") === "true" ? "area" : "population";
const layout = () => $("laySpiral").getAttribute("aria-pressed") === "true" ? "spiral" : "wrapped";

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
    fg: safeColour($("fgColor").value, "#22201c"),
    bg: safeColour($("bgColor").value, "#f7f4ee"),
    transparent: $("optTransparent").checked,
    rotate: $("optRotate").checked,
    dropAffix: $("optAffix").checked && !!affix,
    values: $("optValues").checked && weighted,
    country: $("optCountry").checked,
    caption: cleanText($("capText").value, 120),
    capTop: $("capTop").getAttribute("aria-pressed") === "true"
  };
}

/* Which subdivisions carry the metric now selected. */
/*
  A measure is offered only when every division has it. Drawing the seven
  regions that carry a figure and quietly dropping the other three produces a
  cloud that looks complete and is not, with nothing on the sheet to say so.
*/
function coverage(m){
  const have = subdivisions.filter(s => s[m] !== null).length;
  return {have, total: subdivisions.length, complete: subdivisions.length > 0 && have === subdivisions.length};
}

/*
  freshCountry marks the case where the previous country's choices should not
  carry over: whether to drop a repeated word was a decision about that
  country's naming, and how many to show was about how many it had.
*/
function recomputeUsable(freshCountry){
  const pop = coverage("population"), area = coverage("area");
  $("byPop").disabled = !pop.complete;
  $("byArea").disabled = !area.complete;

  // Land on a measure that actually works, rather than an empty cloud.
  if(metric() === "population" && !pop.complete && area.complete) setSeg($("byArea"), $("byPop"));
  else if(metric() === "area" && !area.complete && pop.complete) setSeg($("byPop"), $("byArea"));

  /*
    With no complete measure there is nothing to size by, but the names are
    still the point of the thing — so the cloud is drawn at one size rather
    than the country being turned away.
  */
  weighted = pop.complete || area.complete;
  usable = subdivisions.slice();

  const m = metric();
  const cov = m === "area" ? area : pop;
  $("optValues").disabled = !weighted;
  if(!weighted) $("optValues").checked = false;
  $("valuesRow").classList.toggle("off", !weighted);

  affix = detectAffix(usable.map(s => s.name));
  const row = $("affixRow");
  row.hidden = !affix;
  // Cleared either way, so a hidden label can never hold a previous country's word.
  $("affixLabel").textContent = affix
    ? `Drop the repeated ${affix.kind} "${affix.text}"` +
      (affix.count < usable.length ? ` (on ${affix.count} of ${usable.length})` : "")
    : "Drop the repeated word";
  if(freshCountry) $("optAffix").checked = true;

  const slider = $("count");
  const max = Math.max(1, usable.length);
  slider.max = String(max);
  slider.disabled = !usable.length;
  if(freshCountry) slider.value = String(Math.max(1, Math.round(max / 2)));
  else if(+slider.value > max || +slider.value < 1) slider.value = String(max);
  $("shuffle").disabled = !usable.length;

  const shortfall = w => `${w.total - w.have} of ${w.total} have no recorded figure`;
  $("countHint").textContent = !subdivisions.length ? ""
    : !weighted
      ? `No complete figures — population: ${shortfall(pop)}; area: ${shortfall(area)}. The names are shown at one size.`
      : cov.complete
        ? `All ${subdivisions.length} divisions have a recorded ${m === "area" ? "area" : "population"}`
        : `${m === "area" ? "Area" : "Population"} is unavailable here: ${shortfall(cov)}.`;
  updateCountOut();
}

function updateCountOut(){
  $("countOut").textContent = usable.length ? `— ${$("count").value} of ${usable.length}` : "";
}

/* A fixed draw: changing colours or the caption must not reshuffle it. */
function repick(){
  const n = clamp(parseInt($("count").value, 10) || 1, 1, Math.max(1, usable.length));
  const pool = usable.slice();
  const rand = rng(seed);
  for(let i = pool.length - 1; i > 0; i--){
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  picked = pool.slice(0, n);
}

/* ═══════════════════════════════════════════════════════════
   Drawing
   ═══════════════════════════════════════════════════════════ */

function palette(){
  const chosenPal = PALETTES.find(p => p.id === $("palette").value) || PALETTES[0];
  return chosenPal.colours;
}

const compact = v => v >= 1e9 ? (v/1e9).toFixed(1) + "bn"
                   : v >= 1e6 ? (v/1e6).toFixed(1) + "m"
                   : v >= 1e3 ? (v/1e3).toFixed(0) + "k"
                   : String(Math.round(v));

function buildTags(opts){
  const m = metric();
  const values = weighted ? picked.map(p => p[m]) : picked.map(() => 1);
  const labels = opts.dropAffix
    ? applyAffix(picked.map(p => p.name), affix)
    : picked.map(p => p.name);
  const rels = relativeSizes(values);
  // Colour follows size rank, so a region keeps its colour as things redraw.
  const ranked = picked.map((p, i) => ({p, i, v: values[i]}))
    .sort((a, b) => b.v - a.v);
  const colourOf = new Map();
  const cols = palette();
  ranked.forEach((r, rank) => colourOf.set(r.i, cols[rank % cols.length]));

  return picked.map((p, i) => ({
    text: opts.values ? `${labels[i]} (${compact(values[i])})` : labels[i],
    rel: rels[i],
    colour: colourOf.get(i)
  }));
}

function drawSheet(canvas, opts){
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
    ctx.font = `500 ${px}px "Fraunces", Georgia, serif`;
    while(px > 14 && ctx.measureText(opts.caption).width > W - pad*2){
      px -= 2; ctx.font = `500 ${px}px "Fraunces", Georgia, serif`;
    }
    if(opts.capTop){ ctx.fillText(opts.caption, W/2, top + px*0.6); top += px * 1.9; }
    else           { ctx.fillText(opts.caption, W/2, bottom - px*0.6); bottom -= px * 1.9; }
  }

  // Small, but not so small it cannot be read: the figures mean nothing
  // without it, and "70.5k" under a region name is otherwise a riddle.
  if(opts.values && picked.length){
    const px = clamp(Math.round(H * 0.024), 13, 30);
    const text = metric() === "area"
      ? `Figures in brackets are area in ${AREA_UNIT_NAME}`
      : "Figures in brackets are population";
    ctx.font = `400 ${px}px "Inter", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.66;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, W/2, bottom - px*0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.0;
  }

  if(opts.country && chosen){
    const px = Math.round(H * 0.030);
    ctx.font = `500 ${px}px "Inter", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.72;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(chosen.name, W/2, bottom - px*0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  if(!picked.length) return;
  const tags = buildTags(opts);
  const boxW = W - pad*2, boxH = bottom - top;
  if(boxW < 20 || boxH < 20) return;

  const placed = fitCloud(ctx, tags, boxW, boxH, layout(), opts.rotate);
  if(!placed) return;

  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for(const t of placed){
    ctx.save();
    ctx.translate(pad + t.x, top + t.y);
    if(t.rotated) ctx.rotate(-Math.PI / 2);
    ctx.font = tagFont(t.px);
    ctx.fillStyle = safeColour(t.colour, "#444444");
    ctx.fillText(t.text, 0, 0);
    ctx.restore();
  }
}

/* ═══════════════════════════════════════════════════════════
   Panels
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
    } else dd.textContent = label;
    dl.append(dt, dd);
  };

  row("Subdivisions", "https://query.wikidata.org/",
      "Wikidata query service — first-level divisions, with population and area");
  row("Country names", "https://cldr.unicode.org/", `Unicode CLDR ${CLDR_VERSION}`);
  for(const p of picked.slice(0, 12)) row(p.name, p.url, p.id);

  const m = metric();
  $("caveat").textContent = [
    "Wikidata decides what counts as a first-level division, and its answer is not always the obvious one — the United Kingdom gives four countries, and the United States includes the federal district and the territories alongside the states.",
    weighted
      ? `Every one of the ${subdivisions.length} divisions found carries the figure shown; a measure is not offered at all unless it is complete, so no region is quietly missing from the cloud.`
      : "",
    weighted
      ? "Sizes are logarithmic and relative to the regions shown, so they say which is bigger, not by how much."
      : "No complete set of population or area figures exists for this country, so every region is drawn at the same size and no figures are shown.",
    (weighted && metric() === "area")
      ? `Areas are converted to ${AREA_UNIT_NAME}. A division recorded in a unit this app does not know counts as having no area, which withdraws the measure for that country rather than showing a figure under the wrong unit.`
      : "",
    (affix && $("optAffix").checked)
      ? `The repeated ${affix.kind} "${affix.text}" has been dropped from the names shown; any region whose shortened name would have matched another keeps its full one.`
      : ""
  ].filter(Boolean).join(" ");
  $("sources").hidden = !picked.length;
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
    code.textContent = c.code;                     // text, never markup
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
  subdivisions = []; usable = []; picked = []; affix = null;
  note("");
  refresh();

  progress("Asking Wikidata for the subdivisions", true);
  try {
    subdivisions = await loadSubdivisions(c.code);
    if(!subdivisions.length){
      note("Wikidata lists no first-level divisions for this country.", true);
    }
  } catch (e) {
    note("Couldn't reach the Wikidata query service: " + cleanText(e && e.message, 60) + ".", true);
  } finally {
    progress(null);
  }
  recomputeUsable(true);
  repick();
  if(subdivisions.length && !weighted)
    note("Wikidata has no complete set of figures for this country, so the regions are shown at one size with no numbers. The names are unaffected.");
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

function refresh(){
  const token = ++busy;
  syncExportState();
  if(!picked.length){
    $("sheetWrap").hidden = true;
    $("empty").style.display = chosen ? "none" : "block";
    $("sources").hidden = true;
    return;
  }
  try {
    drawSheet($("sheet"), currentOptions());
    if(token !== busy) return;
    $("sheetWrap").hidden = false;
    $("empty").style.display = "none";
    renderSources();
  } catch (e) {
    note("Couldn't draw the cloud: " + cleanText(e && e.message, 80), true);
  }
  syncExportState();
}

function syncExportState(){
  const ready = picked.length > 0;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("revealTag").hidden = !$("optCountry").checked;
}

function exportSheet(type, ext){
  const opts = currentOptions();
  if(type === "image/jpeg" && opts.transparent) opts.transparent = false;
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts);
    canvas.toBlob(blob => {
      if(!blob){ note("The browser refused to encode the image.", true); return; }
      let slug;
      if(opts.country && chosen){
        slug = chosen.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      } else {
        let h = 0;
        const s = (chosen ? chosen.code : "") + "|" + seed + "|" + picked.length;
        for(let i = 0; i < s.length; i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
        slug = h.toString(36).slice(0, 6);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `regions-${slug || "sheet"}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, type, 0.95);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
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

function setSeg(on, off){
  on.setAttribute("aria-pressed", "true");
  off.setAttribute("aria-pressed", "false");
}

$("byPop").addEventListener("click", () => {
  setSeg($("byPop"), $("byArea")); recomputeUsable(); repick(); refresh();
});
$("byArea").addEventListener("click", () => {
  setSeg($("byArea"), $("byPop")); recomputeUsable(); repick(); refresh();
});
$("layWrap").addEventListener("click", () => { setSeg($("layWrap"), $("laySpiral")); refresh(); });
$("laySpiral").addEventListener("click", () => { setSeg($("laySpiral"), $("layWrap")); refresh(); });

let countTimer;
$("count").addEventListener("input", () => {
  updateCountOut();
  clearTimeout(countTimer);
  countTimer = setTimeout(() => { repick(); refresh(); }, 180);
});
$("shuffle").addEventListener("click", () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  repick(); refresh();
});

$("frame").addEventListener("change", () => { $("customSize").hidden = $("frame").value !== "custom"; refresh(); });
let sizeTimer;
["customW","customH"].forEach(id => $(id).addEventListener("input", () => {
  clearTimeout(sizeTimer); sizeTimer = setTimeout(refresh, 400);
}));

["optRotate","optValues","optCountry","optTransparent","optAffix"].forEach(id =>
  $(id).addEventListener("change", () => { syncExportState(); refresh(); }));

$("palette").addEventListener("change", () => { renderSwatches(); refresh(); });

let capTimer;
$("capText").addEventListener("input", () => {
  $("capPosField").hidden = !cleanText($("capText").value, 120);
  clearTimeout(capTimer); capTimer = setTimeout(refresh, 300);
});
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

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

function renderSwatches(){
  $("swatches").replaceChildren(...palette().map(c => {
    const i = document.createElement("i");
    i.style.background = safeColour(c, "#888888");
    return i;
  }));
}

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

$("palette").replaceChildren(...PALETTES.map(p => {
  const o = document.createElement("option");
  o.value = p.id; o.textContent = p.name;
  return o;
}));
renderSwatches();
$("capPosField").hidden = !cleanText($("capText").value, 120);
syncExportState();
progress("Loading the country list", true);
loadCountries()
  .then(() => {
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — name or code`;
    input.focus();
    progress(null);
  })
  .catch(err => {
    progress(null);
    note("Couldn't load the country list: " + cleanText(err && err.message, 70) +
         ". Check your connection and reload.", true);
  });
