/* ═══════════════════════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════════════════════ */

const CDN = "https://cdn.jsdelivr.net";
const TOPO_URL = `${CDN}/npm/world-atlas@2/countries-50m.json`;

/*
  Natural Earth's 1:50m admin-1 file covers only 34 large federal countries —
  Germany and Kenya are simply not in it — and its 1:10m edition runs to some
  57 MB. geoBoundaries publishes one small file per country instead, covering
  the world, so only the country being drawn is ever fetched.
*/
/*
  geoBoundaries keeps its GeoJSON in Git LFS. Both jsDelivr and GitHub's raw
  endpoint hand back the pointer file, because that is genuinely what the
  repository holds; only the media endpoint resolves the pointer to the data.
*/
const GEOB_PATH = iso3 =>
  `wmgeolab/geoBoundaries/main/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1_simplified.geojson`;

const REGION_HOSTS = [
  iso3 => `https://media.githubusercontent.com/media/${GEOB_PATH(iso3)}`,
  iso3 => `https://raw.githubusercontent.com/${GEOB_PATH(iso3)}`,
  iso3 => `${CDN}/gh/wmgeolab/geoBoundaries@main/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1_simplified.geojson`
];

/* Where geoBoundaries itself says the file is, if the direct addresses fail. */
const GEOB_API = iso3 => `https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM1/`;

/* A download address from a response is only followed if it leads somewhere
   this page is already allowed to reach. */
const ALLOWED_DATA_HOSTS = new Set([
  "media.githubusercontent.com", "raw.githubusercontent.com", "cdn.jsdelivr.net"
]);
function safeDataUrl(u){
  try {
    const url = new URL(String(u));
    return url.protocol === "https:" && ALLOWED_DATA_HOSTS.has(url.hostname) ? url.href : null;
  } catch (e) { return null; }
}

/*
  Read the bytes and decode them as UTF-8 rather than letting the response
  decide. GitHub serves Git LFS objects as a binary type, and text() then
  falls back to a one-byte encoding, which turns "Región de Antofagasta" into
  "RegiÃ³n de Antofagasta".
*/
async function readUtf8(response){
  const buf = await response.arrayBuffer();
  return new TextDecoder("utf-8").decode(buf);
}

/* "version https://git-lfs.github.com/spec/v1" — a stand-in, not the data. */
const isLfsPointer = text => /^\s*version https:\/\/git-lfs\./.test(String(text).slice(0, 80));

/* It is keyed by ISO alpha-3; the outlines carry the numeric code. */
const URL_COUNTRY_CODES = `${CDN}/gh/datasets/country-codes@main/data/country-codes.csv`;

const MAX_PIXELS = 32e6;
/* Mercator runs to infinity at the poles; this is the usual working limit. */
const MERCATOR_LIMIT = 85.05112878;

/* Islands within this of the main landmass stay with it. */
const CLUSTER_KM = 400;

/*
  Countries where nearness alone gives the wrong answer. Corsica is close
  enough to France to belong, French Guiana is not; Alaska is far from the
  lower 48 but larger than most countries, so an area rule keeps it. These
  boxes say what "the mainland" means, and are the same ones the imagery
  app uses.
*/
const MAINLAND_OVERRIDE = {
  "Norway":        {lon:[4.5, 31.2],  lat:[57.9, 71.2]},
  "Russia":        {lon:[19.6, 180],  lat:[41.2, 77.8]},
  "Fiji":          {lon:[176.8, 182], lat:[-19.2, -16.1]},
  "Kiribati":      {lon:[172.9, 210], lat:[-11.5, 4.7]},
  "New Zealand":   {lon:[166.4, 178.6], lat:[-47.3, -34.4]},
  "France":        {lon:[-5.2, 9.6],  lat:[41.3, 51.1]},
  "Netherlands":   {lon:[3.3, 7.3],   lat:[50.7, 53.6]},
  "United States of America": {lon:[-125, -66.9], lat:[24.4, 49.4]},
  "Chile":         {lon:[-75.7, -66.4], lat:[-56.0, -17.5]},
  "Ecuador":       {lon:[-81.1, -75.2], lat:[-5.0, 1.5]},
  "Portugal":      {lon:[-9.6, -6.1], lat:[36.9, 42.2]},
  "Spain":         {lon:[-9.4, 4.4],  lat:[35.9, 43.8]},
  "Denmark":       {lon:[8.0, 15.2],  lat:[54.5, 57.8]},
  "Yemen":         {lon:[42.5, 54.6], lat:[12.1, 19.0]}
};

/* Names people type that the geometry files do not use. */
const ALIASES = {
  "United States of America": ["usa", "us", "united states", "america"],
  "United Kingdom": ["uk", "great britain", "britain", "england"],
  "Russia": ["russian federation"],
  "Czechia": ["czech republic"],
  "Myanmar": ["burma"],
  "Netherlands": ["holland"],
  "Germany": ["deutschland", "brd"],
  "Switzerland": ["schweiz", "suisse"],
  "Austria": ["osterreich", "oesterreich"],
  "Côte d'Ivoire": ["ivory coast", "cote divoire"],
  "Eswatini": ["swaziland"],
  "Türkiye": ["turkey"],
  "Cabo Verde": ["cape verde"],
  "Timor-Leste": ["east timor"],
  "Dem. Rep. Congo": ["drc", "democratic republic of the congo", "congo kinshasa"],
  "Congo": ["republic of the congo", "congo brazzaville"]
};

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const own = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const isNum = v => typeof v === "number" && Number.isFinite(v);
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

/* ═══════════════════════════════════════════════════════════
   TopoJSON, decoded here rather than by a library

   Everything is validated on the way through: a malformed arc index or a
   name that is not a string drops the shape rather than the page.
   ═══════════════════════════════════════════════════════════ */

function decodeArcs(topo){
  const {scale, translate} = topo.transform || {scale:[1,1], translate:[0,0]};
  const out = [];
  for(const arc of topo.arcs){
    if(!Array.isArray(arc)) { out.push([]); continue; }
    let x = 0, y = 0;
    const line = [];
    for(const p of arc){
      if(!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) continue;
      x += p[0]; y += p[1];
      line.push([x * scale[0] + translate[0], y * scale[1] + translate[1]]);
    }
    out.push(line);
  }
  return out;
}

function ringFrom(arcs, indices){
  const ring = [];
  for(const idx of indices){
    if(!Number.isInteger(idx)) return null;
    const i = idx < 0 ? ~idx : idx;
    const arc = arcs[i];
    if(!arc) return null;
    const part = idx < 0 ? arc.slice().reverse() : arc;
    for(let k = ring.length ? 1 : 0; k < part.length; k++) ring.push(part[k]);
  }
  return ring.length >= 4 ? ring : null;
}

function topoCountries(topo){
  if(!topo || typeof topo !== "object") throw new Error("not an object");
  if(!Array.isArray(topo.arcs)) throw new Error("no arcs");
  const coll = topo.objects && topo.objects.countries;
  if(!coll || !Array.isArray(coll.geometries)) throw new Error("no countries");

  const arcs = decodeArcs(topo);
  const out = [];
  for(const g of coll.geometries){
    const name = cleanText(g && g.properties && g.properties.name, 80);
    if(!name) continue;
    // The numeric ISO code, which the region files are reached through.
    const id = cleanText(g && g.id, 8);
    const polys = [];
    const groups = g.type === "Polygon" ? [g.arcs]
                 : g.type === "MultiPolygon" ? g.arcs : [];
    for(const rings of groups){
      if(!Array.isArray(rings)) continue;
      const built = [];
      for(const r of rings){
        if(!Array.isArray(r)) continue;
        const ring = ringFrom(arcs, r);
        if(ring) built.push(ring);
      }
      if(built.length) polys.push(built);
    }
    if(polys.length) out.push({name, id, polys});
  }
  return out.sort((a,b) => a.name.localeCompare(b.name));
}

/* ═══════════════════════════════════════════════════════════
   Regions, fetched only when first wanted
   ═══════════════════════════════════════════════════════════ */

let REGIONS = null;        // regions of the country currently chosen
let REGION_ISO = "";       // the alpha-3 code they were fetched under
let ISO3_BY_NUMERIC = null;

function regionPolys(geometry){
  if(!geometry) return [];
  const groups = geometry.type === "Polygon" ? [geometry.coordinates]
               : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  const out = [];
  for(const rings of groups){
    if(!Array.isArray(rings)) continue;
    const built = [];
    for(const ring of rings){
      if(!Array.isArray(ring) || ring.length < 4) continue;
      const pts = ring.filter(p => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
      if(pts.length >= 4) built.push(pts);
    }
    if(built.length) out.push(built);
  }
  return out;
}

/* Enough CSV for one well-formed published table. */
function parseCsv(text){
  const rows = [];
  let row = [], field = "", quoted = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(quoted){
      if(c === '"'){ if(text[i+1] === '"'){ field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if(c === '"') quoted = true;
    else if(c === ","){ row.push(field); field = ""; }
    else if(c === "\n"){ row.push(field); rows.push(row); row = []; field = ""; }
    else if(c !== "\r") field += c;
  }
  if(field || row.length){ row.push(field); rows.push(row); }
  return rows;
}

/*
  Numeric to alpha-3, from a published crosswalk rather than from memory, and
  spot-checked so a silently wrong table cannot send one country's regions
  out under another's name.
*/
const CODE_SPOT_CHECK = [["276","DEU"],["404","KEN"],["840","USA"],["250","FRA"]];

async function loadCodes(){
  if(ISO3_BY_NUMERIC) return ISO3_BY_NUMERIC;
  const r = await fetch(URL_COUNTRY_CODES);
  if(!r.ok) throw new Error("HTTP " + r.status);
  const rows = parseCsv(await readUtf8(r));
  if(rows.length < 2) throw new Error("the code table was empty");

  const head = rows[0].map(h => cleanText(h, 60).toLowerCase());
  const findCol = names => head.findIndex(h => names.some(n => h === n));
  const iNum = findCol(["iso3166-1-numeric", "iso3166-1-numeric-code", "m49", "un m49"]);
  const iA3  = findCol(["iso3166-1-alpha-3", "iso3166-1-alpha3"]);
  if(iNum < 0 || iA3 < 0) throw new Error("no numeric/alpha-3 columns");

  const map = new Map();
  for(let i = 1; i < rows.length; i++){
    const row = rows[i];
    if(!row || row.length <= Math.max(iNum, iA3)) continue;
    const num = cleanText(row[iNum], 4).replace(/\D/g, "");
    const a3 = cleanText(row[iA3], 4).toUpperCase();
    if(!num || !/^[A-Z]{3}$/.test(a3)) continue;
    map.set(String(parseInt(num, 10)), a3);
  }
  const wrong = CODE_SPOT_CHECK.filter(([n, a]) => map.get(String(parseInt(n, 10))) !== a);
  if(wrong.length)
    throw new Error("the code table failed its check on " + wrong.map(w => w[1]).join(", "));

  ISO3_BY_NUMERIC = map;
  return map;
}

const iso3For = country => {
  if(!ISO3_BY_NUMERIC || !country || !country.id) return "";
  return ISO3_BY_NUMERIC.get(String(parseInt(country.id, 10))) || "";
};

/* One country's first-level divisions, fetched on demand. */
async function loadRegionsFor(country){
  await loadCodes();
  const iso3 = iso3For(country);
  if(!iso3){ const e = new Error("no ISO code for this country"); e.soft = true; throw e; }

  let data = null, missing = false;
  const tried = [];
  for(const build of REGION_HOSTS){
    const url = build(iso3);
    const host = url.split("/")[2];
    let r;
    try { r = await fetch(url); }
    catch (e) { tried.push(`${host} → ${cleanText(e && e.message, 30)}`); continue; }
    if(r.status === 404){ missing = true; tried.push(`${host} → not found`); continue; }
    if(!r.ok){ tried.push(`${host} → HTTP ${r.status}`); continue; }

    const text = await readUtf8(r);
    // A pointer parses as neither JSON nor anything useful; say what it is.
    if(isLfsPointer(text)){ tried.push(`${host} → returned a Git LFS pointer, not the data`); continue; }
    try { data = JSON.parse(text); }
    catch (e) { tried.push(`${host} → not JSON`); continue; }
    if(data && Array.isArray(data.features)) break;
    tried.push(`${host} → no features`);
    data = null;
  }

  // Last resort: ask geoBoundaries where the file is rather than assuming.
  if(!data){
    try {
      const meta = await fetch(GEOB_API(iso3));
      if(meta.ok){
        const info = await meta.json();
        const rec = Array.isArray(info) ? info[0] : info;
        const candidate = safeDataUrl(rec && (rec.simplifiedGeometryGeoJSON || rec.gjDownloadURL));
        if(candidate){
          const r2 = await fetch(candidate);
          const t2 = r2.ok ? await readUtf8(r2) : "";
          if(t2 && !isLfsPointer(t2)){
            try {
              const parsed = JSON.parse(t2);
              if(parsed && Array.isArray(parsed.features)) data = parsed;
            } catch (e) { tried.push("the address geoBoundaries gave → not JSON"); }
          } else if(t2) tried.push("the address geoBoundaries gave → a Git LFS pointer too");
          else tried.push("the address geoBoundaries gave → HTTP " + r2.status);
        } else tried.push("geoBoundaries named a download host this page may not reach");
      } else tried.push("geoboundaries.org → HTTP " + meta.status);
    } catch (e) {
      tried.push("geoboundaries.org → " + cleanText(e && e.message, 30));
    }
  }

  if(!data){
    const e = new Error(missing && tried.every(t => /not found/.test(t))
      ? "geoBoundaries has no ADM1 file for " + iso3
      : "couldn't get the regions for " + iso3 + " — " + tried.join("; "));
    e.soft = missing && tried.every(t => /not found/.test(t));
    throw e;
  }

  const out = [];
  for(const f of data.features){
    const pr = (f && f.properties) || {};
    const name = cleanText(pr.shapeName || pr.shapeISO || pr.name || "", 80);
    if(!name) continue;
    const polys = regionPolys(f && f.geometry);
    if(!polys.length) continue;
    out.push({name, polys});
  }
  out.sort((a,b) => a.name.localeCompare(b.name));
  REGION_ISO = iso3;
  return out;
}

/* ═══════════════════════════════════════════════════════════
   Geometry: project, keep what is wanted, turn it around
   ═══════════════════════════════════════════════════════════ */

function mercator(lon, lat){
  const la = clamp(lat, -MERCATOR_LIMIT, MERCATOR_LIMIT) * Math.PI / 180;
  return [lon * Math.PI / 180, Math.log(Math.tan(Math.PI/4 + la/2))];
}

/* Rough ground distance in km, good enough for clustering islands. */
function distKm(a, b){
  const mlat = (a[1]+b[1])/2 * Math.PI/180;
  const dx = (a[0]-b[0]) * Math.cos(mlat) * 111.32;
  const dy = (a[1]-b[1]) * 110.57;
  return Math.hypot(dx, dy);
}

const decimate = (ring, n) => {
  if(ring.length <= n) return ring;
  const step = ring.length / n, out = [];
  for(let i = 0; i < n; i++) out.push(ring[Math.floor(i*step)]);
  return out;
};

/*
  Ground area, not projected area. Measuring after Mercator would make Alaska
  look bigger than the lower 48 and let it win the "main landmass" test.
*/
function groundArea(ring){
  const mlat = ring.reduce((s,p) => s + p[1], 0) / ring.length * Math.PI/180;
  return ringArea(ring) * Math.cos(mlat) * 111.32 * 110.57;
}

/* Shoelace area, for deciding which landmass is the main one. */
function ringArea(ring){
  let a = 0;
  for(let i = 0, n = ring.length; i < n; i++){
    const [x0, y0] = ring[i], [x1, y1] = ring[(i+1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

/*
  Project a subject to plane coordinates. A polygon spanning the antimeridian
  is shifted east rather than drawn as a band across the whole world.
*/
function projectSubject(polys, mainOnly, name){
  const use = mainOnly ? mainlandPolys(polys, name) : polys;
  const projected = use.map(rings => {
    const out = rings.map(ring => {
      let wrap = false;
      for(let i = 1; i < ring.length; i++){
        if(Math.abs(ring[i][0] - ring[i-1][0]) > 180){ wrap = true; break; }
      }
      return ring.map(([lon, lat]) => mercator(wrap && lon < 0 ? lon + 360 : lon, lat));
    });
    return {rings: out};
  }).filter(p => p.rings.length);

  return projected.map(p => p.rings);
}

/*
  Everything the mainland test needs: ground area, a centre, a radius for
  cheap rejection, and a thinned outline for the distance test.
*/
function describePolys(polys){
  return polys.map(rings => {
    const outer = rings[0];
    const cx = outer.reduce((s,p) => s + p[0], 0) / outer.length;
    const cy = outer.reduce((s,p) => s + p[1], 0) / outer.length;
    const centroid = [cx, cy];
    const pts = decimate(outer, 40);
    const radius = pts.reduce((m,p) => Math.max(m, distKm(p, centroid)), 0);
    return {rings, area: groundArea(outer), centroid, pts, radius};
  }).sort((a, b) => b.area - a.area);
}

function minPolyDist(a, b){
  // Cheap rejection first: if the discs cannot come close, skip the
  // point-by-point test. Archipelagos depend on this.
  const gap = distKm(a.centroid, b.centroid) - a.radius - b.radius;
  if(gap > CLUSTER_KM) return gap;
  let best = Infinity;
  for(const p of a.pts) for(const q of b.pts){
    const d = distKm(p, q);
    if(d < best) best = d;
  }
  return best;
}

/* The largest landmass and everything that reaches it, directly or by hops. */
function mainlandSet(described){
  const inSet = new Set([0]);
  const frontier = [0];
  const pending = new Set(described.map((_, i) => i));
  pending.delete(0);
  while(frontier.length){
    const i = frontier.pop();
    for(const j of [...pending]){
      if(minPolyDist(described[i], described[j]) <= CLUSTER_KM){
        pending.delete(j); inSet.add(j); frontier.push(j);
      }
    }
  }
  return inSet;
}

const inBox = (centroid, box) => {
  let lon = centroid[0];
  if(box.lon[1] > 180 && lon < 0) lon += 360;   // boxes that run past the seam
  return lon >= box.lon[0] && lon <= box.lon[1] &&
         centroid[1] >= box.lat[0] && centroid[1] <= box.lat[1];
};

/* Which landmasses count as the mainland, by name where nearness misleads. */
function mainlandPolys(polys, name){
  const described = describePolys(polys);
  if(!described.length) return [];
  const box = own(MAINLAND_OVERRIDE, name);
  if(box){
    const kept = described.filter(p => inBox(p.centroid, box));
    return (kept.length ? kept : [described[0]]).map(p => p.rings);
  }
  const set = mainlandSet(described);
  return described.filter((_, i) => set.has(i)).map(p => p.rings);
}

function boundsOf(polys){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const rings of polys) for(const ring of rings) for(const [x, y] of ring){
    if(x < x0) x0 = x; if(x > x1) x1 = x;
    if(y < y0) y0 = y; if(y > y1) y1 = y;
  }
  return Number.isFinite(x0) && x1 > x0 && y1 > y0 ? {x0, y0, x1, y1} : null;
}

/*
  Turn about the shape's own centre, mirror, and hand back a fresh set of
  points. Rotating before fitting means the outline fills the frame at any
  angle rather than shrinking into a corner.
*/
function transformPolys(polys, deg, flipH, flipV, about){
  /*
    The centre must be given when regions are turned with their country:
    spinning each one about its own middle leaves them in place while the
    country rotates beneath them.
  */
  const b = about || boundsOf(polys);
  if(!b) return polys;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const a = (deg % 360) * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const sx = flipH ? -1 : 1, sy = flipV ? -1 : 1;

  return polys.map(rings => rings.map(ring => ring.map(([x, y]) => {
    const dx = (x - cx) * sx, dy = (y - cy) * sy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  })));
}

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

let COUNTRIES = [];
let chosen = null, chosenRegion = null;
let busy = 0;

const isRegionMode = () => $("modeRegion").getAttribute("aria-pressed") === "true";
const mainOnly = () => $("extMain").getAttribute("aria-pressed") === "true";

function progress(label, frac, pending){
  const bar = $("bar");
  if(label === null){ bar.style.display = "none"; bar.classList.remove("pending"); $("loadLabel").textContent = ""; return; }
  bar.style.display = "block";
  bar.classList.toggle("pending", !!pending || !isNum(frac));
  if(isNum(frac)) bar.firstElementChild.style.width = Math.round(clamp(frac,0,1) * 100) + "%";
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
    line: safeColour($("lineColor").value, "#f0a048"),
    lineWidth: clamp(+$("lineWidth").value || 0, 0, 24),
    fill: safeColour($("fillColor").value, "#2b303b"),
    hole: $("fillNone").checked,
    bg: safeColour($("bgColor").value, "#0f1115"),
    bgNone: $("bgNone").checked,
    rotate: clamp(+$("rotate").value || 0, 0, 359),
    flipH: $("flipH").getAttribute("aria-pressed") === "true",
    flipV: $("flipV").getAttribute("aria-pressed") === "true",
    margin: clamp(+$("margin").value || 0, 0, 30) / 100,
    name: $("optName").checked,
    caption: cleanText($("capText").value, 120),
    capTop: $("capTop").getAttribute("aria-pressed") === "true",
    capColour: safeColour($("capColor").value, "#e9ecf2"),
    footnote: cleanText($("noteText").value, 160)
  };
}

/* What is actually being drawn, in geographic coordinates. */
function subjectPolys(){
  if(isRegionMode()) return chosenRegion ? chosenRegion.polys : null;
  return chosen ? chosen.polys : null;
}

/* ═══════════════════════════════════════════════════════════
   Drawing
   ═══════════════════════════════════════════════════════════ */

function tracePath(ctx, polys, map){
  ctx.beginPath();
  for(const rings of polys) for(const ring of rings){
    ring.forEach(([x, y], i) => {
      const [px, py] = map(x, y);
      if(i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }
}

function drawSheet(canvas, opts){
  const {W, H} = frameSpec();
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  const pad = Math.round(Math.min(W, H) * 0.055);
  let top = pad, bottom = H - pad;

  if(!opts.bgNone){ ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, W, H); }

  /*
    A footnote belongs below everything else, so it claims the bottom edge
    before the caption and the name are placed.
  */
  if(opts.footnote){
    const px = clamp(Math.round(H * 0.024), 12, 30);
    ctx.fillStyle = opts.capColour;
    ctx.globalAlpha = 0.6;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let size = px;
    ctx.font = `400 ${size}px "Space Grotesk", sans-serif`;
    while(size > 9 && ctx.measureText(opts.footnote).width > W - pad*2){
      size -= 1; ctx.font = `400 ${size}px "Space Grotesk", sans-serif`;
    }
    ctx.fillText(opts.footnote, W/2, bottom - size*0.6);
    ctx.globalAlpha = 1;
    bottom -= size * 2.0;
  }

  if(opts.caption){
    const capPx = Math.round(H * 0.045);
    ctx.fillStyle = opts.capColour;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let px = capPx;
    ctx.font = `500 ${px}px "Space Grotesk", sans-serif`;
    while(px > 14 && ctx.measureText(opts.caption).width > W - pad*2){
      px -= 2; ctx.font = `500 ${px}px "Space Grotesk", sans-serif`;
    }
    if(opts.capTop){ ctx.fillText(opts.caption, W/2, top + px*0.6); top += px * 1.9; }
    else           { ctx.fillText(opts.caption, W/2, bottom - px*0.6); bottom -= px * 1.9; }
  }

  if(opts.name && (chosen || chosenRegion)){
    const px = Math.round(H * 0.030);
    ctx.font = `400 ${px}px "Space Grotesk", sans-serif`;
    ctx.fillStyle = opts.capColour;
    ctx.globalAlpha = 0.7;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const label = isRegionMode() && chosenRegion
      ? `${chosenRegion.name} · ${chosen ? chosen.name : ""}`.replace(/ · $/, "")
      : (chosen ? chosen.name : "");
    ctx.fillText(label, W/2, bottom - px*0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  const raw = subjectPolys();
  if(!raw) return;
  const flat = projectSubject(raw, mainOnly(), chosen ? chosen.name : "");
  const pivot = boundsOf(flat);          // shared by the country and its regions
  if(!pivot) return;
  const shape = transformPolys(flat, opts.rotate, opts.flipH, opts.flipV, pivot);
  const b = boundsOf(shape);
  if(!b) return;

  const boxW = (W - pad*2) * (1 - opts.margin), boxH = (bottom - top) * (1 - opts.margin);
  if(boxW <= 4 || boxH <= 4) return;
  const scale = Math.min(boxW / (b.x1 - b.x0), boxH / (b.y1 - b.y0));
  const offX = W/2 - (b.x0 + b.x1)/2 * scale;
  const offY = (top + bottom)/2 + (b.y0 + b.y1)/2 * scale;
  // Latitude grows upward in the projection and downward on a canvas.
  const map = (x, y) => [x * scale + offX, offY - y * scale];

  /*
    A hole is made by erasing, not by painting: fill the background first,
    then cut the interior out of it, so whatever lies behind the image shows
    through while the background colour still holds outside the shape.
  */
  if(opts.hole){
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    tracePath(ctx, shape, map);
    ctx.fill("evenodd");        // a country enclosing another keeps its hole
    ctx.restore();
  } else {
    ctx.fillStyle = opts.fill;
    tracePath(ctx, shape, map);
    ctx.fill("evenodd");
  }

  if(opts.lineWidth > 0){
    ctx.strokeStyle = opts.line;
    ctx.lineWidth = Math.max(0.5, opts.lineWidth * Math.min(W, H) / 900);
    ctx.lineJoin = "round";
    tracePath(ctx, shape, map);
    ctx.stroke();
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

  row("Country outlines", "https://github.com/topojson/world-atlas",
      "Natural Earth admin-0, 1:50m, public domain — via world-atlas");
  if(REGIONS && isRegionMode()){
    row("Region outlines", "https://www.geoboundaries.org/",
        `geoBoundaries ADM1, simplified${REGION_ISO ? " — " + REGION_ISO : ""} · CC BY 4.0`);
    row("Country codes", "https://github.com/datasets/country-codes",
        "Numeric to alpha-3 crosswalk, public domain dedication");
  }

  const caveats = [
    "Drawn in Web Mercator, the projection people know from web maps — which is what makes a shape recognisable, and also what stretches anything far from the equator."
  ];
  if(mainOnly() && !isRegionMode())
    caveats.push(own(MAINLAND_OVERRIDE, chosen ? chosen.name : "")
      ? "The mainland here is defined by name rather than by nearness, because distance alone gets this country wrong — France without French Guiana, the United States without Alaska and Hawaii."
      : "Only the largest landmass and whatever lies within 400 km of it is drawn, so distant islands and overseas territories are left out.");
  if(REGIONS && isRegionMode())
    caveats.push("Region outlines come from geoBoundaries, which requires attribution under CC BY 4.0. Its first level is not the same kind of division in every country, and these are the simplified outlines rather than the full-precision ones.");
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !(chosen || chosenRegion);
}

/* ═══════════════════════════════════════════════════════════
   Picking
   ═══════════════════════════════════════════════════════════ */

let matches = [], cursor = 0;

function searchCountries(q){
  const n = norm(q);
  if(!n) return [];
  const scored = [];
  for(const c of COUNTRIES){
    const name = norm(c.name);
    const alts = (own(ALIASES, c.name) || []).map(norm);
    let score = -1;
    if(name === n || alts.includes(n)) score = 0;
    else if(name.startsWith(n) || alts.some(a => a.startsWith(n))) score = 1;
    else if(name.includes(n) || alts.some(a => a.includes(n))) score = 2;
    if(score >= 0) scored.push({c, score});
  }
  return scored.sort((a,b) => a.score - b.score || a.c.name.localeCompare(b.c.name))
               .slice(0, 9).map(s => s.c);
}

function renderResults(){
  $("countryResults").replaceChildren(...matches.map((c, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.name = c.name;
    if(i === cursor) b.className = "on";
    b.textContent = c.name;                        // text, never markup
    return b;
  }));
}

async function pickCountry(c){
  if(!c) return;
  chosen = c; chosenRegion = null; REGIONS = null; REGION_ISO = "";
  $("country").value = c.name;
  matches = []; renderResults();
  resetTurns();
  note("");
  if(isRegionMode()) await ensureRegions();
  fillRegions();
  refresh();
}

/* Regions belong to one country now, so they are refetched when it changes. */
async function ensureRegions(){
  if(!chosen) return false;
  if(REGIONS && REGION_ISO && REGION_ISO === iso3For(chosen)) return true;
  REGIONS = null; chosenRegion = null;
  progress(`Fetching regions of ${chosen.name}`, 0, true);
  try {
    REGIONS = await loadRegionsFor(chosen);
    if(!REGIONS.length){
      note(`geoBoundaries lists no first-level divisions for ${chosen.name}.`);
      return false;
    }
    note("");
    return true;
  } catch (e) {
    REGIONS = null;
    note((e && e.soft ? "" : "Couldn't fetch the regions: ") +
         cleanText(e && e.message, 300) + ". Country outlines still work.", !(e && e.soft));
    return false;
  } finally {
    progress(null);
  }
}

function fillRegions(){
  const sel = $("region");
  const list = REGIONS || [];
  sel.replaceChildren(...list.map((r, i) => new Option(r.name, String(i))));
  sel.disabled = !list.length;
  chosenRegion = list.length ? list[0] : null;
  $("regionHint").textContent = !chosen ? ""
    : list.length ? `${list.length} first-level divisions${REGION_ISO ? " · " + REGION_ISO : ""}`
    : "";
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

function refresh(){
  const token = ++busy;
  syncUI();
  if(!subjectPolys()){
    $("sheetWrap").hidden = true;
    $("empty").style.display = "block";
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
    note("Couldn't draw the outline: " + cleanText(e && e.message, 80), true);
  }
  syncUI();
}

function syncUI(){
  const ready = !!subjectPolys();
  const transparent = $("bgNone").checked || $("fillNone").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent
    ? "JPEG cannot store transparency — export as PNG" : "";
  $("pngOnly").hidden = !$("bgNone").checked;
  $("holeTag").hidden = !$("fillNone").checked;
  $("holeHint").hidden = !$("fillNone").checked;
  $("fillColor").disabled = $("fillNone").checked;
  $("fillHex").disabled = $("fillNone").checked;
  $("bgColor").disabled = $("bgNone").checked;
  $("bgHex").disabled = $("bgNone").checked;
  $("revealTag").hidden = !$("optName").checked;
  $("regionField").hidden = !isRegionMode();
  $("extentField").hidden = isRegionMode();
  $("rotateOut").textContent = $("rotate").value + "°";
  $("marginOut").textContent = $("margin").value + "%";
  $("lineWidthOut").textContent = $("lineWidth").value;
}

function resetTurns(){
  $("rotate").value = "0";
  $("flipH").setAttribute("aria-pressed", "false");
  $("flipV").setAttribute("aria-pressed", "false");
}

function exportSheet(type, ext){
  const opts = currentOptions();
  if(type === "image/jpeg"){ opts.bgNone = false; opts.hole = false; }
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts);
    canvas.toBlob(blob => {
      if(!blob){ note("The browser refused to encode the image.", true); return; }
      // The filename shouldn't give away what the picture is hiding.
      let slug;
      const subject = isRegionMode() && chosenRegion ? chosenRegion.name : (chosen ? chosen.name : "");
      if(opts.name && subject){
        slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      } else {
        let h = 0;
        const seed = subject + "|" + opts.rotate + "|" + opts.flipH + opts.flipV;
        for(let i = 0; i < seed.length; i++) h = (h*31 + seed.charCodeAt(i)) >>> 0;
        slug = h.toString(36).slice(0, 6);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `outline-${slug || "shape"}.${ext}`;
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

function setSeg(on, off){
  on.setAttribute("aria-pressed", "true");
  off.setAttribute("aria-pressed", "false");
}

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

$("modeCountry").addEventListener("click", async () => {
  setSeg($("modeCountry"), $("modeRegion"));
  resetTurns();
  $("capText").value = "Which country is this?";
  refresh();
});
$("modeRegion").addEventListener("click", async () => {
  setSeg($("modeRegion"), $("modeCountry"));
  resetTurns();
  $("capText").value = "What country is this region in?";
  syncUI();
  if(await ensureRegions()) fillRegions();
  refresh();
});

$("region").addEventListener("change", () => {
  const list = REGIONS || [];
  const i = parseInt($("region").value, 10);
  chosenRegion = Number.isInteger(i) ? list[i] || null : null;
  resetTurns();
  refresh();
});

$("extMain").addEventListener("click", () => { setSeg($("extMain"), $("extAll")); refresh(); });
$("extAll").addEventListener("click", () => { setSeg($("extAll"), $("extMain")); refresh(); });

let turnTimer;
["rotate","margin","lineWidth"].forEach(id => $(id).addEventListener("input", () => {
  syncUI();
  clearTimeout(turnTimer);
  turnTimer = setTimeout(refresh, 90);
}));
[["rot0","0"],["rot90","90"],["rot180","180"],["rot270","270"]].forEach(([id, deg]) =>
  $(id).addEventListener("click", () => { $("rotate").value = deg; syncUI(); refresh(); }));
["flipH","flipV"].forEach(id => $(id).addEventListener("click", () => {
  const b = $(id);
  b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true");
  refresh();
}));

["fillNone","bgNone","optName"].forEach(id =>
  $(id).addEventListener("change", () => { syncUI(); refresh(); }));

let noteTimer;
$("noteText").addEventListener("input", () => {
  clearTimeout(noteTimer); noteTimer = setTimeout(refresh, 300);
});

$("frame").addEventListener("change", () => { $("customSize").hidden = $("frame").value !== "custom"; refresh(); });
let sizeTimer;
["customW","customH"].forEach(id => $(id).addEventListener("input", () => {
  clearTimeout(sizeTimer); sizeTimer = setTimeout(refresh, 400);
}));

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
bindColour("lineColor", "lineHex");
bindColour("fillColor", "fillHex");
bindColour("bgColor", "bgHex");
bindColour("capColor", "capHex");

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

syncUI();
progress("Loading country outlines", 0, true);
fetch(TOPO_URL)
  .then(r => { if(!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then(topo => {
    COUNTRIES = topoCountries(topo);
    if(!COUNTRIES.length) throw new Error("no usable outlines");
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — start typing`;
    input.focus();
    progress(null);
  })
  .catch(err => {
    progress(null);
    note("Couldn't load the country outlines: " + cleanText(err && err.message, 70) +
         ". Check your connection and reload.", true);
  });
