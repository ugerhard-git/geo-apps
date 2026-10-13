/* ═══════════════════════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════════════════════ */

const GIBS = {
  "3857": "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi",
  "4326": "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
};

/* EOX serves EPSG:4326 only; other projections are resampled here. */
const EOX_WMS = "https://tiles.maps.eox.at/wms";
const EOX_ATTRIBUTION = y =>
  `Sentinel-2 cloudless ${y} by EOX IT Services GmbH (modified Copernicus Sentinel data), CC BY-NC-SA 4.0`;

// nativeRes = metres per pixel of the underlying data
const LAYERS = {
  night: [
    {id:"VIIRS_Black_Marble",              name:"Black Marble — clean composite", res:500,  dated:false},
    {id:"VIIRS_CityLights_2012",           name:"Earth at Night 2012",            res:500,  dated:false}
  ],
  day: [
    {id:"BlueMarble_ShadedRelief_Bathymetry", name:"Blue Marble — relief, cloud-free", res:500, dated:false},
    {id:"BlueMarble_NextGeneration",          name:"Blue Marble — natural, cloud-free", res:500, dated:false},
    {id:"MODIS_Terra_CorrectedReflectance_TrueColor", name:"MODIS — single day, has clouds", res:250, dated:true, from:"2000-02-24"},
    {id:"VIIRS_SNPP_CorrectedReflectance_TrueColor",  name:"VIIRS — single day, has clouds", res:250, dated:true, from:"2015-11-24"}
  ]
};

/*
  Sentinel-2 cloudless from EOX: 10 m and recent, but CC BY-NC-SA, so it is
  non-commercial and the attribution has to travel with the exported image.
  Their free tier is fair-use — fine for authoring, not for production traffic.
*/
for(const year of [2024, 2023, 2022, 2021, 2020]){
  LAYERS.day.push({
    id: "s2cloudless-" + year,
    name: `Sentinel-2 cloudless ${year} — 10 m`,
    res: 10, dated: false, host: "eox", only4326: true,
    attribution: EOX_ATTRIBUTION(year)
  });
}

/*
  GIBS vector layers ship a mapbox-gl style and are typeset by the client.
  The WMS endpoint rasterises them with a server-side default style, which
  draws geometry but not text — so Reference_Labels_15m yields anchor points
  with no names and isn't offered here. Rendering it properly would mean
  parsing MVT tiles and placing the type ourselves.
*/
const OVERLAY_LAYERS = {
  ovCoast: "Coastlines_15m",
  ovFeat:  "Reference_Features_15m"
};

const OVERLAY_LABEL = {
  Coastlines_15m:        "coastlines",
  Reference_Features_15m: "borders and rivers"
};

const TOPO_URL      = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";
/*
  Several candidates each, tried in order. Mirrors of the same public-domain
  Natural Earth layers differ in path and packaging, and one being unavailable
  shouldn't take the feature down.
*/
/*
  Sizes are the uncompressed byte counts, which is what a stream reader
  produces. The content-length header can't be used for this: it reports the
  compressed size, so a bar driven by it would race past 100%. Only the first
  entry's size is confirmed; the rest fall back to an unknown total.
*/
const PLACES_URLS = [
  {url:"https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson", bytes: 4_700_000},
  {url:"https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/cultural/ne_10m_populated_places_simple.json"},
  {url:"https://cdn.jsdelivr.net/npm/natural-earth-vector@5/geojson/ne_10m_populated_places_simple.geojson", bytes: 4_700_000},
  {url:"https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_populated_places_simple.geojson"}
];

/* Optional: built-up footprints. Without them a population model stands in. */
const URBAN_URLS = [
  {url:"https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/cultural/ne_10m_urban_areas.json"},
  {url:"https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_urban_areas.geojson"},
  {url:"https://cdn.jsdelivr.net/npm/natural-earth-vector@5/geojson/ne_10m_urban_areas.geojson"}
];
const CITY_MIN_KM   = 12;     // floor so a small town isn't zoomed absurdly
const METRO_MULT    = 2.0;    // metro framing relative to the built-up core
const NIGHT_MIN_KM  = 90;     // night data is 500 m; tight framing is pointless
const CLUSTER_KM    = 400;     // islands within this of the mainland stay in the mainland view
const MAX_SUB       = 2048;    // largest single WMS request edge
const PREVIEW_H     = 620;
const MAX_PIXELS    = 48e6;

/* Countries where the automatic mainland rule needs help. */
const MAINLAND_OVERRIDE = {
  "Norway":        {lon:[4.5, 31.2],  lat:[57.9, 71.2]},   // drop Svalbard & Jan Mayen
  "Russia":        {lon:[19.6, 180],  lat:[41.2, 77.8]},   // clip at the dateline
  "Fiji":          {lon:[176.8, 182], lat:[-19.2, -16.1]}, // crosses the dateline
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

/*
  Natural Earth stores subdivisions by full name, but people type the
  abbreviation — "springfield, il" far more often than "springfield, illinois".
*/
const US_STATES = {
  al:"alabama", ak:"alaska", az:"arizona", ar:"arkansas", ca:"california",
  co:"colorado", ct:"connecticut", de:"delaware", fl:"florida", ga:"georgia",
  hi:"hawaii", id:"idaho", il:"illinois", "in":"indiana", ia:"iowa",
  ks:"kansas", ky:"kentucky", la:"louisiana", me:"maine", md:"maryland",
  ma:"massachusetts", mi:"michigan", mn:"minnesota", ms:"mississippi",
  mo:"missouri", mt:"montana", ne:"nebraska", nv:"nevada", nh:"new hampshire",
  nj:"new jersey", nm:"new mexico", ny:"new york", nc:"north carolina",
  nd:"north dakota", oh:"ohio", ok:"oklahoma", or:"oregon", pa:"pennsylvania",
  ri:"rhode island", sc:"south carolina", sd:"south dakota", tn:"tennessee",
  tx:"texas", ut:"utah", vt:"vermont", va:"virginia", wa:"washington",
  wv:"west virginia", wi:"wisconsin", wy:"wyoming", dc:"district of columbia"
};

/* Alternate names people actually type, including German. */
const ALIASES = {
  "United States of America":["usa","us","united states","amerika","vereinigte staaten"],
  "United Kingdom":["uk","great britain","britain","england","grossbritannien","großbritannien"],
  "Germany":["deutschland","brd"],
  "Netherlands":["holland","niederlande"],
  "Switzerland":["schweiz","suisse","helvetia"],
  "Austria":["oesterreich","österreich"],
  "Czechia":["czech republic","tschechien"],
  "Italy":["italien","italia"],
  "France":["frankreich"],
  "Spain":["spanien","espana","españa"],
  "Sweden":["schweden","sverige"],
  "Norway":["norwegen","norge"],
  "Denmark":["daenemark","dänemark"],
  "Finland":["finnland","suomi"],
  "Poland":["polen","polska"],
  "Greece":["griechenland","hellas"],
  "Hungary":["ungarn","magyarorszag"],
  "Croatia":["kroatien","hrvatska"],
  "Turkey":["tuerkei","türkei","turkiye"],
  "Russia":["russland","russian federation"],
  "China":["prc","peoples republic of china"],
  "Japan":["nippon","nihon"],
  "South Korea":["korea","republic of korea","suedkorea","südkorea"],
  "North Korea":["dprk","nordkorea"],
  "Egypt":["aegypten","ägypten","misr"],
  "Morocco":["marokko","maghreb"],
  "South Africa":["suedafrika","südafrika","rsa"],
  "Belgium":["belgien"],
  "Ireland":["irland","eire"],
  "Iceland":["island"],
  "Portugal":["portugal"],
  "Brazil":["brasilien","brasil"],
  "Mexico":["mexiko"],
  "Argentina":["argentinien"],
  "India":["indien","bharat"],
  "Australia":["australien"],
  "New Zealand":["neuseeland","aotearoa"],
  "Canada":["kanada"],
  "Ukraine":["ukraine"],
  "Romania":["rumaenien","rumänien"],
  "Bulgaria":["bulgarien"],
  "Serbia":["serbien"],
  "Slovakia":["slowakei"],
  "Slovenia":["slowenien"],
  "Lithuania":["litauen"],
  "Latvia":["lettland"],
  "Estonia":["estland"],
  "Saudi Arabia":["saudi arabien"],
  "Thailand":["siam"],
  "Vietnam":["viet nam"],
  "Indonesia":["indonesien"],
  "Philippines":["philippinen"],
  "Nigeria":["nigeria"],
  "Kenya":["kenia"],
  "Ethiopia":["aethiopien","äthiopien"],
  "Israel":["israel"],
  "Iran":["persia","persien"],
  "Iraq":["irak"],
  "Cote d'Ivoire":["ivory coast","elfenbeinkueste"],
  "Czech Republic":["tschechien"]
};

/* ═══════════════════════════════════════════════════════════
   Small helpers
   ═══════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
/* Look up a plain-object table without ever reaching Object.prototype, so a
   country literally named "constructor" or "__proto__" can't match. */
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const norm = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g,"").trim();

const R_EARTH = 6378137;
const MAX_MERC_LAT = 85.05112878;
const MERC_MAX = Math.PI * R_EARTH;   // 20037508.34

const merX = lon => R_EARTH * lon * Math.PI/180;
const merY = lat => R_EARTH * Math.log(Math.tan(Math.PI/4 + clamp(lat,-MAX_MERC_LAT,MAX_MERC_LAT)*Math.PI/360));

/*
  Equal Earth (Šavrič, Patterson & Jenny, 2018) — an equal-area pseudocylindrical
  projection. GIBS doesn't serve it, so imagery is fetched in EPSG:4326 and
  reprojected here. Being pseudocylindrical, latitude depends only on y, which
  makes the reprojection one horizontal stretch per output row.
*/
const EE_A1 = 1.340264, EE_A2 = -0.081106, EE_A3 = 0.000893, EE_A4 = 0.003796;
const SQ3_2 = Math.sqrt(3) / 2;

/* dy/dθ — also the factor relating longitude to x within a row. */
function eeDeriv(th){
  const t2 = th*th, t6 = t2*t2*t2;
  return EE_A1 + 3*EE_A2*t2 + t6*(7*EE_A3 + 9*EE_A4*t2);
}
function eeYofTheta(th){
  const t2 = th*th, t6 = t2*t2*t2;
  return th * (EE_A1 + EE_A2*t2 + t6*(EE_A3 + EE_A4*t2));
}
/* Parametric latitude θ from a projected y (Newton; converges in a few steps). */
function eeTheta(y){
  let th = y;
  for(let i = 0; i < 20; i++){
    const d = (eeYofTheta(th) - y) / eeDeriv(th);
    th -= d;
    if(Math.abs(d) < 1e-13) break;
  }
  return th;
}
function eeX(lonDeg, latDeg){
  const th = Math.asin(SQ3_2 * Math.sin(latDeg * Math.PI/180));
  return R_EARTH * (lonDeg * Math.PI/180) * Math.cos(th) / (SQ3_2 * eeDeriv(th));
}
function eeY(latDeg){
  return R_EARTH * eeYofTheta(Math.asin(SQ3_2 * Math.sin(latDeg * Math.PI/180)));
}
/* Latitude, in degrees, at a given projected y. */
function eeLatOf(y){
  const s = Math.sin(eeTheta(y / R_EARTH)) / SQ3_2;
  return Math.abs(s) > 1 ? null : Math.asin(s) * 180/Math.PI;
}
/* Degrees of longitude per unit x, on the row at parametric latitude θ. */
function eeLonPerX(th){
  return (SQ3_2 * eeDeriv(th) / Math.cos(th)) * 180/Math.PI / R_EARTH;
}

const EE_X_HALF = eeX(180, 0);
const EE_Y_POLE = eeY(90);

/* Project a lon/lat pair into the working plane for the chosen CRS. */
function project(lon, lat, crs){
  if(crs === "3857")   return [merX(lon), merY(lat)];
  if(crs === "eqearth") return [eeX(lon, lat), eeY(lat)];
  return [lon, lat];
}
/* Horizontal extent of the world in the working plane, used for dateline splits. */
const worldHalf = crs =>
  crs === "3857" ? MERC_MAX : crs === "eqearth" ? EE_X_HALF : 180;

/* Vertical limit of the working plane. */
const yLimitFor = crs =>
  crs === "3857" ? merY(MAX_MERC_LAT) : crs === "eqearth" ? EE_Y_POLE : 90;

/* Rough ground distance in km, good enough for island clustering. */
function distKm(a, b){
  const mlat = (a[1]+b[1])/2 * Math.PI/180;
  const dx = (a[0]-b[0]) * Math.cos(mlat) * 111.32;
  const dy = (a[1]-b[1]) * 110.57;
  return Math.hypot(dx, dy);
}

/* ═══════════════════════════════════════════════════════════
   TopoJSON decoding

   Done in-page rather than by loading topojson-client from a CDN. The
   country outlines are data we have to trust somewhat; a third-party
   <script> is code that would run with full access to this page, which is
   a much larger thing to trust. Decoding is ~30 lines, so the dependency
   isn't worth its risk.
   ═══════════════════════════════════════════════════════════ */

const isNum = v => typeof v === "number" && Number.isFinite(v);

function decodeArcs(topo){
  const t = topo.transform;
  const sx = t ? t.scale[0] : 1, sy = t ? t.scale[1] : 1;
  const tx = t ? t.translate[0] : 0, ty = t ? t.translate[1] : 0;

  return topo.arcs.map(arc => {
    let x = 0, y = 0;
    const out = [];
    for(const pt of arc){
      if(!Array.isArray(pt) || !isNum(pt[0]) || !isNum(pt[1])) continue;
      if(t){ x += pt[0]; y += pt[1]; } else { x = pt[0]; y = pt[1]; }
      out.push([x*sx + tx, y*sy + ty]);
    }
    return out;
  });
}

/* Join a ring's arcs end to end; a negative index means "traverse backwards". */
function stitch(arcIdx, arcs){
  const ring = [];
  if(!Array.isArray(arcIdx)) return ring;
  for(const i of arcIdx){
    if(!Number.isInteger(i)) continue;
    const arc = i < 0 ? arcs[~i] : arcs[i];
    if(!arc) continue;
    const pts = i < 0 ? arc.slice().reverse() : arc;
    ring.push(...(ring.length ? pts.slice(1) : pts));
  }
  return ring;
}

/*
  Turn a fetched topology into plain features, validating as we go. Anything
  malformed is dropped rather than trusted; this data arrives over the
  network and is never assumed to be well-formed.
*/
function topoToFeatures(topo, objectName){
  if(!topo || typeof topo !== "object") throw new Error("not an object");
  if(!Array.isArray(topo.arcs)) throw new Error("no arcs");
  const coll = topo.objects && topo.objects[objectName];
  if(!coll || !Array.isArray(coll.geometries)) throw new Error("no geometries");

  const arcs = decodeArcs(topo);
  const out = [];

  for(const g of coll.geometries){
    if(!g || !Array.isArray(g.arcs)) continue;
    let coordinates = null;
    if(g.type === "Polygon")      coordinates = g.arcs.map(r => stitch(r, arcs));
    else if(g.type === "MultiPolygon") coordinates = g.arcs.map(p => p.map(r => stitch(r, arcs)));
    else continue;

    // Every ring needs at least a triangle's worth of real points.
    coordinates = g.type === "Polygon"
      ? [coordinates.filter(r => r.length >= 4)]
      : coordinates.map(p => p.filter(r => r.length >= 4)).filter(p => p.length);
    const polys = g.type === "Polygon" ? coordinates.filter(p => p.length) : coordinates;
    if(!polys.length) continue;

    const rawName = g.properties && g.properties.name;
    const name = typeof rawName === "string" ? rawName.slice(0, 80).trim() : "";
    if(!name) continue;

    out.push({properties:{name}, geometry:{type:"MultiPolygon", coordinates: polys}});
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════
   Country geometry
   ═══════════════════════════════════════════════════════════ */

let COUNTRIES = [];   // {name, polys:[{ring, area, pts, centroid}], mainlandIdx:Set}
let current = null;

function ringArea(ring){
  let a = 0;
  for(let i = 0, n = ring.length; i < n; i++){
    const p = ring[i], q = ring[(i+1) % n];
    a += p[0]*q[1] - q[0]*p[1];
  }
  const meanLat = ring.reduce((s,p)=>s+p[1],0) / ring.length;
  return Math.abs(a/2) * Math.cos(meanLat * Math.PI/180);
}

/* Reduce a ring to at most n points so distance tests stay cheap. */
function decimate(ring, n){
  if(ring.length <= n) return ring;
  const step = ring.length / n, out = [];
  for(let i = 0; i < n; i++) out.push(ring[Math.floor(i*step)]);
  return out;
}

function buildCountry(feature){
  const g = feature.geometry;
  if(!g) return null;
  const raw = g.type === "Polygon" ? [g.coordinates]
            : g.type === "MultiPolygon" ? g.coordinates : [];
  if(!raw.length) return null;

  const polys = raw.map(rings => {
    const outer = rings[0];
    const cx = outer.reduce((s,p)=>s+p[0],0)/outer.length;
    const cy = outer.reduce((s,p)=>s+p[1],0)/outer.length;
    const centroid = [cx, cy];
    const pts = decimate(outer, 40);
    const radius = pts.reduce((m,p) => Math.max(m, distKm(p, centroid)), 0);
    return {rings, area: ringArea(outer), pts, centroid, radius};
  }).sort((a,b) => b.area - a.area);

  return {name: feature.properties.name, polys, mainland: null};
}

function minPolyDist(a, b){
  // Cheap rejection first: if the discs around each landmass can't come close,
  // skip the point-by-point test entirely. Archipelagos depend on this.
  const gap = distKm(a.centroid, b.centroid) - a.radius - b.radius;
  if(gap > CLUSTER_KM) return gap;

  let best = Infinity;
  for(const p of a.pts) for(const q of b.pts){
    const d = distKm(p, q);
    if(d < best) best = d;
  }
  return best;
}

/*
  Which landmasses count as "the mainland": start from the largest, then keep
  absorbing anything within CLUSTER_KM of what's already in. Chaining is what
  keeps Indonesia and the Philippines whole while leaving Hawaii, Svalbard and
  the Canaries out. Computed on demand and cached.
*/
function mainlandSet(country){
  if(country.mainland) return country.mainland;

  const inSet = new Set([0]);
  const frontier = [0];
  const pending = new Set(country.polys.map((_,i) => i));
  pending.delete(0);

  while(frontier.length){
    const i = frontier.pop();
    for(const j of [...pending]){
      if(minPolyDist(country.polys[i], country.polys[j]) <= CLUSTER_KM){
        pending.delete(j); inSet.add(j); frontier.push(j);
      }
    }
  }
  country.mainland = inSet;
  return inSet;
}

/* ═══════════════════════════════════════════════════════════
   Cities

   Natural Earth populated places supply the index — name, country,
   subdivision and population, which is what makes same-name cities
   separable. Urban-area polygons supply the actual built-up footprint;
   where none matches, a population-derived radius stands in.
   ═══════════════════════════════════════════════════════════ */

let CITIES = [];
let URBAN = [];
let cityLoad = null;   // in-flight promise, so a double click loads once

function toRad(d){ return d * Math.PI/180; }

/*
  Rough built-up radius in km when no urban polygon is available.
  Fitted through two anchors — 100k ≈ 5 km, 5M ≈ 30 km — which puts a city
  the size of Berlin near 26 km against a real built-up radius of about 22.
*/
function radiusFromPopulation(pop){
  const p = Math.max(1000, pop || 1000);
  return clamp(0.0256 * Math.pow(p, 0.458), 2.5, 60);
}

/* ═══════════════════════════════════════════════════════════
   Wikidata, for the places Natural Earth leaves out

   Natural Earth states that it favours regional significance over population
   when choosing places, so a city can be large and still be absent — Touba in
   Senegal is the second largest in the country but is neither a national nor
   a regional capital. This fills those gaps on request rather than swapping
   the whole dataset for a heavier one.
   ═══════════════════════════════════════════════════════════ */

const WDQS = "https://query.wikidata.org/sparql";

function cityQuery(term){
  // The search term reaches the API service as a quoted literal, so quotes
  // and backslashes are escaped and control characters never get that far.
  const safe = term.replace(/[\\"]/g, " ").replace(/[\u0000-\u001F]/g, " ").slice(0, 60);
  return `SELECT ?item ?itemLabel ?coord ?pop ?iso ?countryLabel ?adminLabel WHERE {
  SERVICE wikibase:mwapi {
    bd:serviceParam wikibase:api "EntitySearch" .
    bd:serviceParam wikibase:endpoint "www.wikidata.org" .
    bd:serviceParam mwapi:search "${safe}" .
    bd:serviceParam mwapi:language "en" .
    ?item wikibase:apiOutputItem mwapi:item .
  }
  ?item wdt:P31/wdt:P279* wd:Q486972 .
  ?item wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P1082 ?pop }
  OPTIONAL { ?item wdt:P17 ?country . OPTIONAL { ?country wdt:P297 ?iso } }
  OPTIONAL { ?item wdt:P131 ?admin }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
LIMIT 25`;
}

/* Names arrive from a public wiki, so they are stripped and capped here. */
function cleanName(raw, max){
  return String(raw || "")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max || 80);
}

/* "Point(-15.8833 14.85)" — longitude first, as WKT has it. */
function parsePoint(wkt){
  const m = /^Point\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(String(wkt || "").trim());
  if(!m) return null;
  const lon = parseFloat(m[1]), lat = parseFloat(m[2]);
  if(!isNum(lon) || !isNum(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {lon, lat};
}

async function searchWikidataCities(term){
  const r = await fetch(WDQS + "?format=json&query=" + encodeURIComponent(cityQuery(term)));
  if(!r.ok) throw new Error("HTTP " + r.status);
  const data = await r.json();
  const rows = (data && data.results && data.results.bindings) || [];

  const byId = new Map();
  for(const row of rows){
    const id = (/\/(Q\d+)$/.exec(row.item && row.item.value || "") || [])[1];
    if(!id || byId.has(id)) continue;
    const name = cleanName(row.itemLabel && row.itemLabel.value, 80);
    if(!name || /^Q\d+$/.test(name)) continue;          // no English label is no name
    const pt = parsePoint(row.coord && row.coord.value);
    if(!pt) continue;
    const pop = parseFloat(row.pop && row.pop.value);
    byId.set(id, {
      name, ascii: name,
      country: cleanName(row.countryLabel && row.countryLabel.value, 80),
      region: cleanName(row.adminLabel && row.adminLabel.value, 80),
      iso: cleanName(row.iso && row.iso.value, 3),
      pop: Number.isFinite(pop) && pop > 0 ? pop : 0,
      capital: false,
      lon: pt.lon, lat: pt.lat,
      urban: undefined,
      wikidata: id
    });
  }
  return [...byId.values()].sort((a,b) => b.pop - a.pop);
}

function buildCity(f){
  const pr = f.properties || {};
  const name = typeof pr.name === "string" ? pr.name.slice(0,80).trim() : "";
  if(!name) return null;
  const g = f.geometry;
  if(!g || g.type !== "Point" || !Array.isArray(g.coordinates)) return null;
  const [lon, lat] = g.coordinates;
  if(!isNum(lon) || !isNum(lat)) return null;
  return {
    name,
    ascii:   typeof pr.nameascii === "string" ? pr.nameascii.slice(0,80) : name,
    country: typeof pr.adm0name  === "string" ? pr.adm0name.slice(0,80)  : "",
    region:  typeof pr.adm1name  === "string" ? pr.adm1name.slice(0,80)  : "",
    iso:     typeof pr.iso_a2    === "string" ? pr.iso_a2.slice(0,3)     : "",
    pop:     isNum(pr.pop_max) ? pr.pop_max : 0,
    capital: pr.adm0cap === 1,
    lon, lat,
    urban: undefined            // resolved lazily
  };
}

/* Urban polygons, reduced to a bbox plus a decimated ring for hit testing. */
function buildUrban(f){
  const g = f.geometry;
  if(!g) return [];
  const polys = g.type === "Polygon" ? [g.coordinates]
              : g.type === "MultiPolygon" ? g.coordinates : [];
  const out = [];
  for(const rings of polys){
    const outer = rings[0];
    if(!Array.isArray(outer) || outer.length < 4) continue;
    let lo = Infinity, hi = -Infinity, la = Infinity, lb = -Infinity;
    for(const pt of outer){
      if(!isNum(pt[0]) || !isNum(pt[1])) continue;
      lo = Math.min(lo, pt[0]); hi = Math.max(hi, pt[0]);
      la = Math.min(la, pt[1]); lb = Math.max(lb, pt[1]);
    }
    if(!Number.isFinite(lo)) continue;
    out.push({rings, lon0:lo, lon1:hi, lat0:la, lat1:lb});
  }
  return out;
}

function pointInRing(lon, lat, ring){
  let inside = false;
  for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if((yi > lat) !== (yj > lat) &&
       lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* The urban polygons making up this city, in core or metro extent. */
function urbanFor(city, metro){
  if(city.urban === undefined){
    let hit = null;
    for(const u of URBAN){
      if(city.lon < u.lon0 || city.lon > u.lon1 || city.lat < u.lat0 || city.lat > u.lat1) continue;
      if(pointInRing(city.lon, city.lat, u.rings[0])){ hit = u; break; }
    }
    city.urban = hit;
  }
  if(!city.urban) return null;
  if(!metro) return [city.urban];

  // Metro: absorb neighbouring built-up patches, the same transitive rule
  // that keeps an archipelago together.
  const seed = city.urban;
  const reach = 0.16;                       // degrees, ~15 km
  const group = [seed];
  const seen = new Set([seed]);
  let grew = true;
  while(grew && group.length < 400){
    grew = false;
    for(const u of URBAN){
      if(seen.has(u)) continue;
      for(const g of group){
        if(u.lon0 - reach <= g.lon1 && u.lon1 + reach >= g.lon0 &&
           u.lat0 - reach <= g.lat1 && u.lat1 + reach >= g.lat0){
          group.push(u); seen.add(u); grew = true; break;
        }
      }
      if(grew) break;
    }
  }
  return group;
}

function cityBBox(city, metro){
  const patches = urbanFor(city, metro);
  let bb;
  if(patches){
    let lo = Infinity, hi = -Infinity, la = Infinity, lb = -Infinity;
    for(const u of patches){
      lo = Math.min(lo, u.lon0); hi = Math.max(hi, u.lon1);
      la = Math.min(la, u.lat0); lb = Math.max(lb, u.lat1);
    }
    bb = {lon0:lo, lon1:hi, lat0:la, lat1:lb};
  } else {
    const rKm = radiusFromPopulation(city.pop) * (metro ? METRO_MULT : 1);
    const dLat = rKm / 110.57;
    const dLon = rKm / (111.32 * Math.max(0.15, Math.cos(toRad(city.lat))));
    bb = {lon0:city.lon-dLon, lon1:city.lon+dLon, lat0:city.lat-dLat, lat1:city.lat+dLat};
  }
  // Never frame tighter than the imagery can support.
  const floorKm = Math.max(CITY_MIN_KM, isNight() ? NIGHT_MIN_KM : currentLayer().res * 1600 / 1000 / 8);
  return widenTo(bb, floorKm, city);
}

/* Grow a box symmetrically until it spans at least minKm in both directions. */
function widenTo(bb, minKm, at){
  const cLat = (bb.lat0 + bb.lat1) / 2, cLon = (bb.lon0 + bb.lon1) / 2;
  const kmPerLon = 111.32 * Math.max(0.15, Math.cos(toRad(cLat)));
  let hKm = (bb.lat1 - bb.lat0) * 110.57;
  let wKm = (bb.lon1 - bb.lon0) * kmPerLon;
  const out = {...bb};
  if(hKm < minKm){ const d = (minKm - hKm)/2/110.57; out.lat0 -= d; out.lat1 += d; }
  if(wKm < minKm){ const d = (minKm - wKm)/2/kmPerLon; out.lon0 -= d; out.lon1 += d; }
  out.lat0 = Math.max(-89.5, out.lat0); out.lat1 = Math.min(89.5, out.lat1);
  return out;
}

/*
  Try each mirror in turn. Reports what every candidate did, because "couldn't
  load" on its own is impossible to act on.
*/
/* Read a response body in chunks, reporting bytes as they decode. */
async function readJson(response, expected, onBytes){
  if(!response.body || typeof response.body.getReader !== "function"){
    return response.json();                       // no streaming: no progress
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "", received = 0;
  for(;;){
    const {done, value} = await reader.read();
    if(done) break;
    received += value.length;
    text += decoder.decode(value, {stream: true});
    onBytes(received, expected);
  }
  text += decoder.decode();
  return JSON.parse(text);
}

async function fetchFirst(sources, label, onBytes){
  const tried = [];
  for(const src of sources){
    const where = src.url.replace(/^https:\/\/cdn\.jsdelivr\.net\//, "");
    try {
      const r = await fetch(src.url);
      if(!r.ok){ tried.push(`${where} → HTTP ${r.status}`); continue; }
      const data = await readJson(r, src.bytes, onBytes || (() => {}));
      if(!data || !Array.isArray(data.features)){
        tried.push(`${where} → not GeoJSON`); continue;
      }
      return {data, url: src.url, tried};
    } catch (e) {
      tried.push(`${where} → ${e && e.name === "SyntaxError" ? "not JSON" : "unreachable"}`);
    }
  }
  const err = new Error("no source worked");
  err.tried = tried;
  throw err;
}

async function loadCities(){
  if(cityLoad) return cityLoad;
  cityLoad = (async () => {
    const places = await fetchFirst(PLACES_URLS, "places",
      (got, total) => progress("Downloading places", total ? got/total : null, got));  // required

    progress("Indexing places", null);
    await new Promise(r => setTimeout(r, 0));          // let the bar paint
    CITIES = places.data.features.map(buildCity).filter(Boolean)
               .sort((a,b) => b.pop - a.pop);
    if(!CITIES.length){
      const e = new Error("no usable places");
      e.tried = [places.url.split("/").pop() + " → parsed but held no places"];
      throw e;
    }

    // Footprints are a refinement, not a requirement.
    try {
      const urban = await fetchFirst(URBAN_URLS, "urban",
        (got, total) => progress("Downloading built-up areas", total ? got/total : null, got));
      progress("Indexing built-up areas", null);
      await new Promise(r => setTimeout(r, 0));
      URBAN = urban.data.features.flatMap(buildUrban);
    } catch (e) {
      URBAN = [];
      urbanFallbackNote = "Built-up outlines are unavailable, so city extents come from a population model and the footprint overlay is off.";
    }
  })().catch(err => { cityLoad = null; throw err; });   // let a retry work
  return cityLoad;
}

let urbanFallbackNote = "";

/* ═══════════════════════════════════════════════════════════
   Bounding box, with antimeridian handling
   ═══════════════════════════════════════════════════════════ */

function bboxFor(country, mainlandOnly){
  const ov = mainlandOnly ? own(MAINLAND_OVERRIDE, country.name) : undefined;
  if(ov) return {lon0:ov.lon[0], lon1:ov.lon[1], lat0:ov.lat[0], lat1:ov.lat[1]};

  const keep = mainlandOnly ? mainlandSet(country) : null;
  const use = country.polys.filter((p,i) => !keep || keep.has(i));
  const lons = [], lats = [];
  for(const p of use) for(const ring of p.rings) for(const [x,y] of ring){ lons.push(x); lats.push(y); }

  // Iterate rather than spreading into Math.min: Russia alone carries tens of
  // thousands of vertices at 50 m, which overflows the argument limit.
  let lo = Infinity, hi = -Infinity, loW = Infinity, hiW = -Infinity;
  for(const l of lons){
    if(l < lo) lo = l;
    if(l > hi) hi = l;
    const w = l < 0 ? l + 360 : l;
    if(w < loW) loW = w;
    if(w > hiW) hiW = w;
  }
  let latLo = Infinity, latHi = -Infinity;
  for(const l of lats){
    if(l < latLo) latLo = l;
    if(l > latHi) latHi = l;
  }
  const span = (hi - lo) <= (hiW - loW) ? [lo, hi] : [loW, hiW];
  return {lon0:span[0], lon1:span[1], lat0:latLo, lat1:latHi};
}

const nudgeX = () => clamp((+$("nudgeX").value || 0) / 100, -1, 1);
const nudgeY = () => clamp((+$("nudgeY").value || 0) / 100, -1, 1);

/* Turn a geographic box into a framed, nudged box in the working plane. */
function planeBox(bb, crs, padPct, offX, offY){
  const wrapsDateline = bb.lon1 > 180;
  const half = worldHalf(crs);

  /*
    In Equal Earth the meridians curve, so the widest part of a latitude band
    is the row nearest the equator. Measuring x there — rather than at a corner —
    gives the true extent without sampling the whole outline.
  */
  const xAtLat = crs === "eqearth"
    ? ((bb.lat0 <= 0 && bb.lat1 >= 0) ? 0
        : (Math.abs(bb.lat0) < Math.abs(bb.lat1) ? bb.lat0 : bb.lat1))
    : 0;

  let x0 = project(bb.lon0, xAtLat, crs)[0];
  let x1 = wrapsDateline
    ? project(bb.lon1 - 360, xAtLat, crs)[0] + 2*half
    : project(bb.lon1, xAtLat, crs)[0];
  let y0 = project(0, bb.lat0, crs)[1];
  let y1 = project(0, bb.lat1, crs)[1];

  /*
    A multiplier on the subject's extent rather than a margin: 1 frames it
    exactly, below 1 crops into it, above 1 pulls back. Nudges are fractions
    of the framed half-extent, so a nudge covers less ground the tighter the
    framing — which is how moving around a zoomed picture should feel.
  */
  const factor = Math.max(0.05, (Number.isFinite(padPct) ? padPct : 100) / 100);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const halfW = (x1 - x0) / 2 * factor, halfH = (y1 - y0) / 2 * factor;
  const nx = clamp(Number.isFinite(offX) ? offX : 0, -1, 1);
  const ny = clamp(Number.isFinite(offY) ? offY : 0, -1, 1);

  x0 = cx + nx * halfW - halfW; x1 = cx + nx * halfW + halfW;
  y0 = cy + ny * halfH - halfH; y1 = cy + ny * halfH + halfH;

  const yLimit = yLimitFor(crs);
  // Clamp without collapsing the box: shift it back inside, then trim.
  if(y1 - y0 > 2*yLimit){ y0 = -yLimit; y1 = yLimit; }
  else if(y1 > yLimit){ const d = y1 - yLimit; y0 -= d; y1 -= d; }
  else if(y0 < -yLimit){ const d = -yLimit - y0; y0 += d; y1 += d; }
  y0 = clamp(y0, -yLimit, yLimit);
  y1 = clamp(y1, -yLimit, yLimit);
  if(x1 - x0 > 2*half){ x0 = -half; x1 = half; }
  // Keep the left edge inside the world; planRequests splits anything that
  // now runs off the right edge.
  if(x0 < -half){ x0 += 2*half; x1 += 2*half; }

  return {x0, x1, y0, y1};
}

/* ═══════════════════════════════════════════════════════════
   WMS request planning
   ═══════════════════════════════════════════════════════════ */

function requestedOverlays(){
  const ids = [];
  for(const [chk, layer] of Object.entries(OVERLAY_LAYERS)){
    if($(chk).checked) ids.push(layer);
  }
  return ids;
}

function activeLayerIds(){
  return [$("layer").value, ...requestedOverlays()];
}

/*
  WMS composites every requested layer in one call, so one unavailable overlay
  used to take the whole request down with it — and the old all-or-nothing
  retry then silently dropped the overlays that were fine. Probe each overlay
  once per projection with a 2 px request and keep the ones that answer.
*/
const overlayProbe = new Map();

async function usableOverlays(crs, ids, box, time){
  const out = [];
  for(const id of ids){
    const key = crs + "|" + id;
    if(!overlayProbe.has(key)){
      try {
        await loadImage(wmsUrl(crs, box, 2, 2, [id], time));
        overlayProbe.set(key, true);
      } catch (e) {
        overlayProbe.set(key, false);
      }
    }
    if(overlayProbe.get(key)) out.push(id);
  }
  return out;
}

function wmsUrl(crs, box, w, h, layers, time, host){
  const p = new URLSearchParams({
    SERVICE:"WMS", VERSION:"1.1.1", REQUEST:"GetMap",
    LAYERS: layers.join(","), STYLES:"",
    SRS:"EPSG:"+crs,
    BBOX:[box.x0, box.y0, box.x1, box.y1].join(","),
    WIDTH:String(w), HEIGHT:String(h),
    FORMAT:"image/jpeg"
  });
  if(time) p.set("TIME", time);

  if(host === "eox"){
    // EOX publishes EPSG:4326 only; callers resample for other projections.
    if(crs !== "4326") throw new Error("this source is EPSG:4326 only");
    return EOX_WMS + "?" + p.toString();
  }
  const endpoint = own(GIBS, crs);
  if(!endpoint) throw new Error("unknown projection");
  return endpoint + "?" + p.toString();
}

/*
  Split the plane box into requests that the server will accept:
  first across the dateline, then into a grid no larger than MAX_SUB.
*/
function planRequests(box, crs, W, H){
  const half = worldHalf(crs);
  const panels = [];

  if(box.x1 > half){
    const splitFrac = (half - box.x0) / (box.x1 - box.x0);
    const wA = Math.round(W * splitFrac);
    panels.push({x0:box.x0, x1:half,  px:0,  pw:wA});
    panels.push({x0:-half, x1:box.x1 - 2*half, px:wA, pw:W - wA});
  } else {
    panels.push({x0:box.x0, x1:box.x1, px:0, pw:W});
  }

  const jobs = [];
  for(const pan of panels){
    if(pan.pw <= 0) continue;
    const cols = Math.ceil(pan.pw / MAX_SUB);
    const rows = Math.ceil(H / MAX_SUB);
    for(let c = 0; c < cols; c++){
      const px0 = Math.round(pan.pw * c/cols), px1 = Math.round(pan.pw * (c+1)/cols);
      for(let r = 0; r < rows; r++){
        const py0 = Math.round(H * r/rows), py1 = Math.round(H * (r+1)/rows);
        jobs.push({
          dx: pan.px + px0, dy: py0, dw: px1-px0, dh: py1-py0,
          box: {
            x0: pan.x0 + (pan.x1-pan.x0) * px0/pan.pw,
            x1: pan.x0 + (pan.x1-pan.x0) * px1/pan.pw,
            // canvas y grows downward, the plane grows upward
            y1: box.y1 - (box.y1-box.y0) * py0/H,
            y0: box.y1 - (box.y1-box.y0) * py1/H
          }
        });
      }
    }
  }
  return jobs;
}

/*
  GIBS is expected to send Access-Control-Allow-Origin, which keeps the canvas
  clean and lets us export from it. If it doesn't, an anonymous request fails
  outright, so fall back to a plain request: the picture still displays, the
  canvas just becomes read-blocked and export switches to the direct-URL route.
*/
let CORS_MODE = "unknown";   // "unknown" | "anonymous" | "none"

function fetchImage(url, anonymous){
  return new Promise((res, rej) => {
    const img = new Image();
    if(anonymous) img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("request failed"));
    img.src = url;
  });
}

async function loadImage(url){
  if(CORS_MODE === "none") return fetchImage(url, false);
  try {
    const img = await fetchImage(url, true);
    CORS_MODE = "anonymous";
    return img;
  } catch (e) {
    if(CORS_MODE === "anonymous") throw e;      // CORS works; this is a genuine failure
    const img = await fetchImage(url, false);   // succeeds only if the server is reachable
    CORS_MODE = "none";
    tainted = true;
    return img;
  }
}

/* Run tasks a few at a time rather than firing every tile at once. */
async function pool(items, limit, worker){
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({length: Math.min(limit, items.length)}, async () => {
    while(true){
      const i = next++;
      if(i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/* ═══════════════════════════════════════════════════════════
   Rendering
   ═══════════════════════════════════════════════════════════ */

let tainted = false;

/*
  Grow a box until it matches a target aspect, keeping the country centred.
  Growing vertically can run into the projection's latitude ceiling; when it
  does we clamp and slide the box instead, which keeps the country wholly
  visible at the cost of it no longer sitting dead centre.
*/
function expandToAspect(box, crs, target){
  const yLimit = crs === "3857" ? merY(MAX_MERC_LAT) : 90;
  const half = worldHalf(crs);
  let {x0, x1, y0, y1} = box;
  const w = x1 - x0, h = y1 - y0;
  const a = w / h;
  let offCentre = false;

  if(a < target){                       // too narrow — widen
    const nw = h * target, cx = (x0 + x1) / 2;
    x0 = cx - nw/2; x1 = cx + nw/2;
    if(x1 - x0 > 2*half){ x0 = -half; x1 = half; }
    if(x0 < -half){ x0 += 2*half; x1 += 2*half; }
  } else if(a > target){                // too wide — heighten
    const nh = w / target, cy = (y0 + y1) / 2;
    y0 = cy - nh/2; y1 = cy + nh/2;
    if(nh >= 2*yLimit){ y0 = -yLimit; y1 = yLimit; offCentre = true; }
    else if(y1 > yLimit){ const d = y1 - yLimit; y1 -= d; y0 -= d; offCentre = true; }
    else if(y0 < -yLimit){ const d = -yLimit - y0; y0 += d; y1 += d; offCentre = true; }
  }
  return {x0, x1, y0, y1, offCentre};
}

/*
  Fetch imagery for a plane box and paint it into ctx at (dx, dy).
  Returns true if reference overlays had to be dropped.
*/
async function fetchInto(ctx, box, crs, w, h, dx, dy, time, onProgress, host){
  const wanted = host === "eox" ? [] : requestedOverlays();
  const usable = await usableOverlays(crs, wanted, box, time);
  const dropped = wanted.filter(id => !usable.includes(id));
  const layers = [$("layer").value, ...usable];

  const jobs = planRequests(box, crs, w, h);
  let done = 0;
  const total = jobs.length;

  const runAll = async ids => {
    const imgs = await pool(jobs, 5, async j => {
      const img = await loadImage(wmsUrl(crs, j.box, j.dw, j.dh, ids, time, host));
      done++; onProgress && onProgress(done/total);
      return img;
    });
    imgs.forEach((img, i) => {
      const j = jobs[i];
      ctx.drawImage(img, dx + j.dx, dy + j.dy, j.dw, j.dh);
    });
  };

  try {
    await runAll(layers);
  } catch (e) {
    if(layers.length > 1){
      // Something else went wrong mid-composite; the base layer alone is
      // better than nothing.
      done = 0;
      await runAll([layers[0]]);
      return wanted.slice();
    }
    throw e;
  }
  return dropped;
}

/*
  Both Web Mercator and Equal Earth are cylindrical in the sense that matters
  here: a row of output pixels is a single line of latitude, and longitude maps
  linearly to x along it. That is what lets a whole reprojection be one
  drawImage per row — no pixel reads, so it survives a tainted canvas.
*/
const ROW_MAP = {
  "3857": {
    latOf:  y => (2*Math.atan(Math.exp(y / R_EARTH)) - Math.PI/2) * 180/Math.PI,
    lonPerX: () => 180 / Math.PI / R_EARTH
  },
  "eqearth": {
    latOf:  y => eeLatOf(y),
    lonPerX: y => eeLonPerX(eeTheta(y / R_EARTH))
  }
};

/*
  The geographic window a projected box needs. Longitude spreads widest on
  the row furthest from the equator, so sample across the box rather than
  trusting the corners.
*/
function eeSourceWindow(box, crs){
  let lonLo = Infinity, lonHi = -Infinity, latLo = Infinity, latHi = -Infinity;
  let lonSpanMin = Infinity, latStepMin = Infinity;
  const N = 96;
  let prevLat = null;
  const map = own(ROW_MAP, crs);
  if(!map) throw new Error("no row map for " + crs);

  for(let i = 0; i <= N; i++){
    const y = box.y0 + (box.y1 - box.y0) * i/N;
    const lat = map.latOf(y);
    if(lat === null || !Number.isFinite(lat)){ prevLat = null; continue; }
    const k = map.lonPerX(y);
    const l0 = Math.min(k*box.x0, k*box.x1), l1 = Math.max(k*box.x0, k*box.x1);

    lonLo = Math.min(lonLo, l0); lonHi = Math.max(lonHi, l1);
    latLo = Math.min(latLo, lat); latHi = Math.max(latHi, lat);
    lonSpanMin = Math.min(lonSpanMin, l1 - l0);
    if(prevLat !== null) latStepMin = Math.min(latStepMin, Math.abs(lat - prevLat));
    prevLat = lat;
  }
  if(!Number.isFinite(lonLo)) throw new Error("box lies outside the projection");

  // A little slack so edge rows never sample past the fetched image.
  const mx = (lonHi - lonLo) * 0.004 + 0.02;
  const my = (latHi - latLo) * 0.004 + 0.02;
  const win = {
    lon0: lonLo - mx, lon1: lonHi + mx,
    lat0: Math.max(-90, latLo - my), lat1: Math.min(90, latHi + my)
  };

  /*
    A tall Equal Earth frame spans far more longitude on its polar rows than on
    its equatorial ones. Sizing the source to the window alone would starve the
    narrow rows — which is exactly where the country sits — so scale the source
    up by how much wider the window is than the tightest row.
  */
  win.lonOversample = Number.isFinite(lonSpanMin) && lonSpanMin > 0
    ? clamp((win.lon1 - win.lon0) / lonSpanMin, 1, 8) : 1;
  win.latOversample = Number.isFinite(latStepMin) && latStepMin > 0
    ? clamp((win.lat1 - win.lat0) / (latStepMin * N), 1, 8) : 1;

  return win;
}

/* Resample an equirectangular source into the target projection, row by row. */
function reprojectFrom4326(src, win, box, crs, ctx, dx, dy, W, H){
  const map = own(ROW_MAP, crs);
  if(!map) throw new Error("no row map for " + crs);
  const lonSpan = win.lon1 - win.lon0, latSpan = win.lat1 - win.lat0;
  const sw = src.width, sh = src.height;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  for(let py = 0; py < H; py++){
    const y = box.y1 - (py + 0.5)/H * (box.y1 - box.y0);
    const lat = map.latOf(y);
    if(lat === null || !Number.isFinite(lat)) continue;   // outside the projection

    const k  = map.lonPerX(y);
    const u0 = (k*box.x0 - win.lon0) / lonSpan * sw;
    const u1 = (k*box.x1 - win.lon0) / lonSpan * sw;
    const uw = u1 - u0;
    if(!(uw > 0)) continue;

    const v = clamp(Math.floor((win.lat1 - lat) / latSpan * sh), 0, sh - 1);
    ctx.drawImage(src, u0, v, uw, 1, dx, dy + py, W, 1);
  }
}

/*
  Draw the imagery. spec is either {mode:"fit", H} or
  {mode:"fixed", W, H, letterbox}. Captions are applied afterwards by
  composeText, so one set of network requests serves both the clean and
  the captioned export.
*/
async function render(canvas, spec, onProgress){
  if(!current) return null;

  const crs = $("proj").value;
  const bb  = subjectBBox();
  if(!bb) throw new Error("nothing selected");
  let box   = planeBox(bb, crs, +$("pad").value, nudgeX(), nudgeY());

  let natAspect = (box.x1-box.x0) / (box.y1-box.y0);
  // A malformed outline could give a zero-height or infinite box; refuse rather
  // than hand the canvas a NaN size.
  if(!Number.isFinite(natAspect) || natAspect <= 0) throw new Error("degenerate bounding box");
  natAspect = clamp(natAspect, 1/64, 64);

  let w, h, dx = 0, dy = 0, offCentre = false;

  if(spec.mode === "fixed"){
    w = spec.W; h = spec.H;
    if(spec.letterbox){
      // Keep the country's own proportions and centre them in the frame.
      if(natAspect > w/h){ dx = 0;              h = Math.round(w / natAspect); dy = Math.round((spec.H - h)/2); }
      else               { dy = 0;              w = Math.round(h * natAspect); dx = Math.round((spec.W - w)/2); }
    } else {
      const grown = expandToAspect(box, crs, w/h);
      offCentre = grown.offCentre;
      box = grown;
    }
  } else {
    h = spec.H; w = Math.round(spec.H * natAspect);
  }

  if(spec.mode !== "fixed" && w * h > MAX_PIXELS){
    // Native size with 10 m imagery can ask for more canvas than exists.
    const k = Math.sqrt(MAX_PIXELS / (w*h));
    w = Math.max(16, Math.round(w*k)); h = Math.max(16, Math.round(h*k));
  }
  const outW = spec.mode === "fixed" ? spec.W : w;
  const outH = spec.mode === "fixed" ? spec.H : h;
  if(outW * outH > MAX_PIXELS) throw new Error("frame too large");

  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, outW, outH);

  w = clamp(w, 16, 16000);
  h = clamp(h, 16, 16000);

  const time = currentLayer().dated ? $("date").value : "";
  let droppedOverlays = [];

  const srcHost = currentLayer().host || "gibs";
  // Equal Earth has no server endpoint; EOX publishes 4326 only. Either way
  // the fix is the same: fetch equirectangular and resample.
  const needsResample = crs !== "4326" &&
    (crs === "eqearth" || currentLayer().only4326);

  if(needsResample){
    const win = eeSourceWindow(box, crs);
    let sw = clamp(Math.ceil(w * 1.15 * win.lonOversample), 16, 16000);
    let sh = clamp(Math.ceil(h * 1.15 * win.latOversample), 16, 16000);
    if(sw * sh > MAX_PIXELS){
      const k = Math.sqrt(MAX_PIXELS / (sw*sh));
      sw = Math.max(16, Math.round(sw*k)); sh = Math.max(16, Math.round(sh*k));
    }
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = sw; srcCanvas.height = sh;
    const sctx = srcCanvas.getContext("2d");
    sctx.fillStyle = "#000"; sctx.fillRect(0, 0, sw, sh);

    const srcBox = {x0: win.lon0, x1: win.lon1, y0: win.lat0, y1: win.lat1};
    droppedOverlays = await fetchInto(sctx, srcBox, "4326", sw, sh, 0, 0, time, onProgress, srcHost);
    reprojectFrom4326(srcCanvas, win, box, crs, ctx, dx, dy, w, h);
  } else {
    droppedOverlays = await fetchInto(ctx, box, crs, w, h, dx, dy, time, onProgress, srcHost);
  }

  if($("ovOutline").checked){
    ctx.save();
    ctx.beginPath(); ctx.rect(dx, dy, w, h); ctx.clip();
    ctx.translate(dx, dy);
    drawOutline(ctx, box, crs, w, h);
    ctx.restore();
  }

  return {w: outW, h: outH, imgW: w, imgH: h, natAspect, box, crs, bb,
          droppedOverlays, offCentre,
          letterboxed: spec.mode === "fixed" && spec.letterbox};
}

function drawOutline(ctx, box, crs, w, h){
  const half = worldHalf(crs);
  const sx = x => (x - box.x0) / (box.x1 - box.x0) * w;
  const sy = y => (box.y1 - y) / (box.y1 - box.y0) * h;

  ctx.lineWidth = Math.max(1.5, h/650);
  ctx.strokeStyle = "#f0a048";
  ctx.lineJoin = "round";

  const use = subjectPolygons();
  // Draw each ring twice, once shifted a full world east, so dateline spans join up.
  for(const shift of [0, 2*half]){
    for(const rings of use) for(const ring of rings){
      ctx.beginPath();
      ring.forEach(([lon,lat], i) => {
        const [px,py] = project(lon, lat, crs);
        const X = sx(px + shift), Y = sy(py);
        i ? ctx.lineTo(X,Y) : ctx.moveTo(X,Y);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   Caption
   ═══════════════════════════════════════════════════════════ */

const CAPTION_DEFAULT = {night:"#f5efe6", day:"#121a24"};
let capColourTouched = false;
let crdColourTouched = false;

/*
  The caption is drawn with fillText, which parses no markup, so there is no
  injection path here. The stripping below is about the text being an asset
  you ship: bidirectional overrides can make a string render in an order that
  doesn't match its characters, and control codes render as tofu.
*/
const BIDI_AND_CONTROL = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g;

function cleanCaption(raw){
  return String(raw || "")
    .replace(BIDI_AND_CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/* Heights of every solid strip, in pixels of the given frame. */
function stripHeights(spec, cap, credit){
  const capBand = (cap && cap.band) ? Math.round(Math.round(spec.H * cap.frac) * 2.2) : 0;
  const creditPx = Math.max(10, Math.round(spec.H * 0.016));
  const crdBand = (credit && credit.text && credit.band) ? Math.round(creditPx * 2.4) : 0;
  return {
    capBand, crdBand, creditPx,
    top:    (cap && cap.atTop) ? capBand : 0,
    bottom: ((cap && !cap.atTop) ? capBand : 0) + crdBand
  };
}

function bandHeightFor(spec, cap, credit){
  const h = stripHeights(spec, cap, credit);
  return h.top + h.bottom;
}

/*
  What size the imagery itself should be rendered at. A solid band inside a
  fixed frame steals height from the picture, so we render the picture at the
  reduced size rather than rendering full-size and scaling it down — that way
  the exported pixels are real, not resampled, and the frame stays exact.
*/
function imagerySpec(spec, cap, credit){
  const bh = bandHeightFor(spec, cap, credit);
  if(spec.mode === "fixed" && bh > 0){
    return {mode:"fixed", W: spec.W, H: Math.max(16, spec.H - bh), letterbox: spec.letterbox};
  }
  return spec;
}

function captionSpec(){
  const text = cleanCaption($("capText").value);
  if(!text) return null;
  return {
    text,
    atTop: $("capTop").getAttribute("aria-pressed") === "true",
    band:  $("capBand").getAttribute("aria-pressed") === "true",
    colour: safeColour($("capColor").value, CAPTION_DEFAULT[isNight() ? "night" : "day"]),
    frac: clamp(+$("capSize").value, 18, 70) / 1000
  };
}

const HEX6 = /^#?([0-9a-f]{6})$/i;

/* An invalid fillStyle is silently ignored by canvas, leaving whatever was set
   before. Normalise so the colour actually drawn is always the one we chose. */
function safeColour(v, fallback){
  const m = HEX6.exec(String(v || ""));
  return m ? "#" + m[1].toLowerCase() : fallback;
}

/* Relative luminance, used to decide whether the scrim goes dark or light. */
function luminance(hex){
  const m = HEX6.exec(String(hex));
  if(!m) return 1;
  const n = parseInt(m[1], 16);
  const lin = c => { c /= 255; return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  return 0.2126*lin(n>>16 & 255) + 0.7152*lin(n>>8 & 255) + 0.0722*lin(n & 255);
}

/* Shrink to fit, then truncate with an ellipsis if it still won't go. */
function fitCaption(ctx, text, maxW, basePx){
  let px = basePx;
  const setFont = () => ctx.font = `500 ${px}px "IBM Plex Sans", system-ui, sans-serif`;
  setFont();
  while(px > basePx*0.55 && ctx.measureText(text).width > maxW){ px -= 1; setFont(); }
  if(ctx.measureText(text).width > maxW){
    let t = text;
    while(t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    text = t + "…";
  }
  return {text, px};
}

/*
  Build a new canvas carrying the caption. The source imagery is reused rather
  than re-fetched, so a clean/captioned pair costs one set of requests.
  Band mode grows the canvas when the frame is free, and insets the imagery
  when the frame is fixed — 2400 × 1600 has to stay 2400 × 1600.
*/
/*
  Lay the caption and the projection credit onto the imagery.

  The credit always sits bottom right. When the caption is also along the
  bottom, the caption's usable width is narrowed symmetrically by the credit's
  width, so a centred caption can never reach across into it — the two never
  overlap regardless of how long the caption is.
*/
function composeText(src, cap, credit, fixedFrame){
  const refH   = fixedFrame ? fixedFrame.H : src.height;
  const spec   = {H: refH};
  const strip  = stripHeights(spec, cap, credit);

  const basePx   = cap ? Math.max(8, Math.round(refH * cap.frac)) : 0;
  const capStrip = cap ? Math.round(basePx * 2.2) : 0;   // band height, or scrim depth
  const creditPx = (credit && credit.text) ? strip.creditPx : 0;
  const margin   = Math.round((creditPx || 10) * 0.9);

  const outW = fixedFrame ? fixedFrame.W : src.width;
  const outH = fixedFrame ? fixedFrame.H : src.height + strip.top + strip.bottom;

  const out = document.createElement("canvas");
  out.width = outW; out.height = outH;
  const ctx = out.getContext("2d");

  const scrimFor = colour => luminance(colour) > 0.45 ? [10, 16, 23] : [242, 244, 246];
  const capScrim = scrimFor(cap ? cap.colour : "#ffffff");
  const crdScrim = scrimFor(credit ? credit.colour : "#ffffff");

  const rgb = c => `rgb(${c.join(",")})`;
  const fade = (top, height, colour, downward) => {
    const g = downward
      ? ctx.createLinearGradient(0, top, 0, top + height)
      : ctx.createLinearGradient(0, top + height, 0, top);
    g.addColorStop(0, `rgba(${colour.join(",")},0.82)`);
    g.addColorStop(0.65, `rgba(${colour.join(",")},0.45)`);
    g.addColorStop(1, `rgba(${colour.join(",")},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, top, outW, height);
  };

  // Solid strips, bottom edge first: attribution band sits below a caption band.
  const crdBandTop = outH - strip.crdBand;
  const capBandBottomTop = crdBandTop - strip.capBand;

  if(strip.crdBand){ ctx.fillStyle = rgb(crdScrim); ctx.fillRect(0, crdBandTop, outW, strip.crdBand); }
  if(strip.capBand){
    ctx.fillStyle = rgb(capScrim);
    ctx.fillRect(0, cap.atTop ? 0 : capBandBottomTop, outW, strip.capBand);
  }

  // The source was rendered at exactly the space left between the strips.
  ctx.drawImage(src, 0, strip.top, src.width, src.height);

  // Where the picture stops and the bottom strips begin.
  const imageFoot = outH - strip.bottom;

  // Measure the attribution: whether it can share a line depends on its width.
  let creditText = "", creditW = 0;
  if(creditPx){
    ctx.font = `400 ${creditPx}px "IBM Plex Sans", system-ui, sans-serif`;
    const fittedCredit = fitCaption(ctx, credit.text, outW - margin * 3, creditPx);
    creditText = fittedCredit.text;
    ctx.font = `400 ${fittedCredit.px}px "IBM Plex Sans", system-ui, sans-serif`;
    creditW = ctx.measureText(creditText).width;
    strip.creditDrawPx = fittedCredit.px;
  }

  /*
    Caption and attribution collide only when both are overlays on the bottom
    edge. Narrowing the caption works while the attribution is short — a
    projection name — but a full licence string is far too wide for that, and
    the old width floor let them overlap. So: share the line when the reserved
    space genuinely leaves the caption half the frame, otherwise give the
    attribution its own line underneath.
  */
  const sameEdge = !!cap && !cap.atTop && creditPx > 0 && !credit.band;
  const reserve  = sameEdge ? 2 * (creditW + margin * 2) : 0;
  const share    = sameEdge && (outW * 0.92 - reserve) >= outW * 0.45;
  const creditRow = (sameEdge && !share) ? Math.round(creditPx * 1.9) : 0;

  if(cap){
    const bandMode = !!cap.band;
    if(!bandMode){
      const depth = capStrip + creditRow;
      fade(cap.atTop ? strip.top : imageFoot - depth, depth, capScrim, cap.atTop);
    }
    const budget = share ? Math.max(outW * 0.45, outW * 0.92 - reserve) : outW * 0.92;
    const fitted = fitCaption(ctx, cap.text, budget, basePx);
    ctx.font = `500 ${fitted.px}px "IBM Plex Sans", system-ui, sans-serif`;
    ctx.fillStyle = cap.colour;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cy = bandMode
      ? (cap.atTop ? strip.capBand/2 : capBandBottomTop + strip.capBand/2)
      : (cap.atTop ? strip.top + capStrip * 0.42
                   : imageFoot - creditRow - capStrip * 0.42);
    ctx.fillText(fitted.text, outW/2, cy);
  }

  if(creditPx){
    if(!credit.band && !(cap && !cap.atTop && !cap.band)){
      // Nothing else darkens this edge, so the attribution brings its own.
      fade(imageFoot - creditPx * 3, creditPx * 3, crdScrim, false);
    }
    ctx.font = `400 ${strip.creditDrawPx}px "IBM Plex Sans", system-ui, sans-serif`;
    ctx.fillStyle = credit.colour;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const cy = credit.band
      ? crdBandTop + strip.crdBand/2
      : imageFoot - creditPx * 1.05;
    ctx.globalAlpha = credit.band ? 1 : 0.92;
    ctx.fillText(creditText, outW - margin * 2, cy);
    ctx.globalAlpha = 1;
  }

  return out;
}

const PROJECTION_NAME = {
  "3857":    "Web Mercator projection",
  "4326":    "Equirectangular projection",
  "eqearth": "Equal Earth projection"
};

/*
  CC BY-NC-SA requires the attribution to travel with the image, not merely to
  sit in the interface, so a non-commercial source forces the credit line on
  and prepends its attribution to the projection name.
*/
function creditSpec(){
  const attribution = currentLayer().attribution || "";
  // City mode never names the projection; a required licence credit still runs.
  const wantsProjection = !isCity() && $("showProj").checked;
  if(!wantsProjection && !attribution) return null;
  const parts = [attribution, wantsProjection ? own(PROJECTION_NAME, $("proj").value) : ""].filter(Boolean);
  return {
    text: parts.join(" · "),
    band: $("crdBand").getAttribute("aria-pressed") === "true",
    colour: safeColour($("crdColor").value, CAPTION_DEFAULT[isNight() ? "night" : "day"])
  };
}

/* Canvas silently substitutes a fallback face if the webfont isn't ready. */
async function ensureFont(px){
  if(!document.fonts || !document.fonts.load) return;
  try { await document.fonts.load(`500 ${px}px "IBM Plex Sans"`); } catch(e){ /* fallback stack */ }
}

/* ═══════════════════════════════════════════════════════════
   UI state
   ═══════════════════════════════════════════════════════════ */

const isCity = () => $("modeCity").getAttribute("aria-pressed") === "true";
const mainlandOnly = () => $("segMain").getAttribute("aria-pressed") === "true";

/*
  Countries and cities differ only in where their extent and outline come
  from. Everything downstream — framing, projection, captions, export —
  works through these three.
*/
function subjectBBox(){
  if(!current) return null;
  return isCity() ? cityBBox(current, !mainlandOnly())
                  : bboxFor(current, mainlandOnly());
}

function subjectPolygons(){
  if(!current) return [];
  if(!isCity()){
    const keep = mainlandOnly() ? mainlandSet(current) : null;
    return current.polys.filter((p,i) => !keep || keep.has(i)).map(p => p.rings);
  }
  const patches = urbanFor(current, !mainlandOnly());
  return patches ? patches.map(u => u.rings) : [];
}

function subjectName(){
  if(!current) return "";
  return isCity() ? current.name : current.name;
}

/* A city's disambiguating line: "Springfield · Illinois · United States". */
function subjectQualifier(){
  if(!current || !isCity()) return "";
  return [current.region, current.country].filter(Boolean).join(" · ");
}
const isNight      = () => $("segNight").getAttribute("aria-pressed") === "true";
const currentLayer = () => {
  const id = $("layer").value;
  return [...LAYERS.day, ...LAYERS.night].find(l => l.id === id) || LAYERS.night[0];
};

function setSeg(onBtn, offBtn){
  onBtn.setAttribute("aria-pressed","true");
  offBtn.setAttribute("aria-pressed","false");
}

/*
  Daytime opens on the most recent Sentinel-2 mosaic for either subject: at
  10 m it is the finest source available, and at country scale it is simply
  downsampled. Night has no such option and opens on Black Marble.
*/
function defaultLayerFor(list){
  if(!isNight()){
    const s2 = list.filter(l => /^s2cloudless-\d{4}$/.test(l.id));
    if(s2.length){
      return s2.reduce((best, l) =>
        parseInt(l.id.slice(-4), 10) > parseInt(best.id.slice(-4), 10) ? l : best).id;
    }
  }
  return list[0].id;
}

function fillLayers(){
  const list = isNight() ? LAYERS.night : LAYERS.day;
  const sel = $("layer");
  sel.replaceChildren(...list.map(l => new Option(l.name, l.id)));
  sel.value = defaultLayerFor(list);
  syncDateField();
}

function syncDateField(){
  const l = currentLayer();
  $("dateField").hidden = !l.dated;
  if(l.dated){
    const d = $("date");
    d.min = l.from || "1999-01-01";
    d.max = l.to || new Date(Date.now() - 864e5).toISOString().slice(0,10);
    if(!d.value || d.value < d.min || d.value > d.max){
      d.value = new Date(Date.now() - 7*864e5).toISOString().slice(0,10);
    }
  }
}

/*
  Resolve the frame controls into a render spec. Custom values are clamped
  hard: a stray digit here is an enormous canvas allocation.
*/
/*
  The tallest output at which every pixel is real data, given the current
  source and extent. For 500 m night imagery over a city this is small — which
  is the point: it shows what is actually there before any upscaling.
*/
function nativeHeight(){
  const bb = subjectBBox();
  if(!bb) return 1600;
  const heightM = (bb.lat1 - bb.lat0) * 110570 * Math.max(0.05, (+$("pad").value || 100) / 100);
  return clamp(Math.round(heightM / currentLayer().res), 64, 16000);
}

function frameSpec(){
  const v = $("frame").value;
  if(v === "native") return {mode:"fit", H: nativeHeight(), native:true};
  if(v.startsWith("fit:")) return {mode:"fit", H: clamp(parseInt(v.slice(4), 10) || 1600, 64, 16000)};

  let W, H;
  if(v === "custom"){
    W = clamp(Math.round(+$("customW").value) || 0, 64, 16000);
    H = clamp(Math.round(+$("customH").value) || 0, 64, 16000);
  } else {
    const [a, b] = v.split("x");
    W = clamp(parseInt(a, 10) || 2400, 64, 16000);
    H = clamp(parseInt(b, 10) || 1600, 64, 16000);
  }
  if(W * H > MAX_PIXELS){
    const k = Math.sqrt(MAX_PIXELS / (W*H));
    W = Math.max(64, Math.round(W*k)); H = Math.max(64, Math.round(H*k));
  }
  return {mode:"fixed", W, H, letterbox: $("fillBars").getAttribute("aria-pressed") === "true"};
}

/* Scale a spec down to preview size, keeping proportions exact. */
function previewSpec(spec){
  if(spec.mode === "fit") return {mode:"fit", H: PREVIEW_H};
  const k = Math.min(1, PREVIEW_H / spec.H);
  return {mode:"fixed", W: Math.max(16, Math.round(spec.W*k)), H: Math.max(16, Math.round(spec.H*k)),
          letterbox: spec.letterbox};
}

const MB = b => (b / 1048576).toFixed(1) + " MB";

/*
  frac null means the total isn't known, and the bar sweeps rather than
  pretending to a percentage.
*/
function progress(label, frac, bytes){
  const bar = $("bar");
  if(label === null){
    bar.style.display = "none";
    bar.classList.remove("pending");
    $("loadLabel").textContent = "";
    return;
  }
  bar.style.display = "block";
  if(frac === null || frac === undefined){
    bar.classList.add("pending");
    bar.firstElementChild.style.width = "";
  } else {
    bar.classList.remove("pending");
    bar.firstElementChild.style.width = clamp(frac * 100, 0, 100) + "%";
  }
  $("loadLabel").textContent = bytes ? `${label} · ${MB(bytes)}` : label;
}

/* Imagery fetches always know their total, and carry no label. */
function renderBar(frac){
  const bar = $("bar");
  if(frac === null){ progress(null); return; }
  bar.classList.remove("pending");
  bar.style.display = "block";
  bar.firstElementChild.style.width = clamp(frac * 100, 0, 100) + "%";
  $("loadLabel").textContent = "";
}

function note(msg, isErr){
  const n = $("note");
  n.textContent = msg || "";
  n.className = "note" + (isErr ? " err" : "");
}

/* ═══════════════════════════════════════════════════════════
   Preview pipeline
   ═══════════════════════════════════════════════════════════ */

let previewToken = 0;
let lastMeta = null;   // geometry of the most recent preview, for the readout

async function updatePreview(){
  if(!current) return;
  const token = ++previewToken;
  renderBar(0);
  note("");

  try {
    const spec  = frameSpec();
    const pspec = previewSpec(spec);
    const cap    = captionSpec();
    const credit = creditSpec();
    const base   = document.createElement("canvas");

    const r = await render(base, imagerySpec(pspec, cap, credit), p => {
      if(token === previewToken) renderBar(p);
    });
    if(token !== previewToken) return;

    if(cap) await ensureFont(Math.round(pspec.H * cap.frac));
    if(token !== previewToken) return;

    const shown = (cap || (credit && credit.text))
      ? composeText(base, cap, credit, pspec.mode === "fixed" ? pspec : null)
      : base;

    const pv = $("preview");
    pv.width = shown.width; pv.height = shown.height;
    pv.getContext("2d").drawImage(shown, 0, 0);

    r.spec = spec;

    $("preview").style.display = "block";
    $("empty").style.display = "none";
    ["dlPng","dlJpg","copyUrl"].forEach(id => $(id).disabled = false);

    if(!tainted){
      try { base.getContext("2d").getImageData(0,0,1,1); }
      catch(e){
        tainted = true;
        note("This browser is blocking pixel access to NASA's servers, so in-page export is unavailable. Use “Copy image URL”, open it, and save the image directly — you'll get the full-size frame without the country outline.");
      }
    }
    lastMeta = r;
    /*
      The picture is already on screen by this point, so nothing below may be
      allowed to report itself as a failure to fetch it. An error here is a
      fault in the annotations, not in the imagery.
    */
    try {
      showReadout(r);
      syncFraming();
      const messages = [];
      if(r.droppedOverlays && r.droppedOverlays.length){
        const names = r.droppedOverlays.map(id => own(OVERLAY_LABEL, id) || id).join(" and ");
        messages.push(`GIBS has no ${names} in this projection. Switch to Equirectangular or Equal Earth to use ${r.droppedOverlays.length > 1 ? "them" : "it"}.`);
      }
      const detail = detailWarning();
      if(detail) messages.push(detail);
      if(messages.length) note(messages.join(" "));
    } catch (e) {
      note("The image is fine, but the readout beside it failed: " +
           cleanName(e && e.message, 80) + ".", true);
    }
  } catch (e) {
    if(token !== previewToken) return;
    /*
      This used to blame the imagery service for every failure, including
      faults in this page's own code. Say which it was, and name the error, so
      an unexpected one is reportable rather than misattributed.
    */
    const msg = cleanName(e && e.message, 90);
    const fetchFailed = /^HTTP |^http |Failed to fetch|NetworkError|load error/i.test(msg);
    note(fetchFailed
      ? `The imagery service didn't return a picture (${msg}). A dated layer may have nothing for that day — try another date, or a composite source that isn't date-based.`
      : `Couldn't build the image: ${msg}. This one is the page's fault rather than the imagery service's.`, true);
  } finally {
    if(token === previewToken) renderBar(null);
  }
}

function showReadout(r){
  const spec   = r.spec || frameSpec();
  const cap    = captionSpec();
  // This read a bare "credit", which exists nowhere: a ReferenceError on every
  // successful render, swallowed by the outer catch and reported as a failure
  // to fetch imagery.
  const credit = creditSpec();
  const ispec  = imagerySpec(spec, cap, credit);
  const bandH  = bandHeightFor(spec, cap, credit);
  const nat   = r.natAspect;

  // Imagery pixels at export scale, and the finished canvas around them.
  let imageryW, imageryH, outW, outH;
  if(ispec.mode === "fixed"){
    if(ispec.letterbox){
      if(nat > ispec.W/ispec.H){ imageryW = ispec.W; imageryH = Math.round(ispec.W / nat); }
      else                     { imageryH = ispec.H; imageryW = Math.round(ispec.H * nat); }
    } else {
      imageryW = ispec.W; imageryH = ispec.H;
    }
    outW = spec.W; outH = spec.H;
  } else {
    imageryH = ispec.H; imageryW = Math.round(ispec.H * nat);
    outW = imageryW; outH = imageryH + bandH;
  }

  // Ground metres per pixel across the imagery, at the centre of the frame.
  const midLat = (r.bb.lat0 + r.bb.lat1) / 2;
  const widthM = r.crs === "3857"
    ? (r.box.x1 - r.box.x0) * Math.cos(midLat * Math.PI/180)
    : (r.box.x1 - r.box.x0) * 111320 * Math.cos(midLat * Math.PI/180);
  const mpp = widthM / imageryW;
  const native = currentLayer().res;
  const factor = native / mpp;

  const fmt = (v, ax) => {
    const d = Math.abs(v).toFixed(1);
    return d + "°" + (ax === "lon" ? (v < 0 ? "W" : "E") : (v < 0 ? "S" : "N"));
  };
  const lon1 = r.bb.lon1 > 180 ? r.bb.lon1 - 360 : r.bb.lon1;

  // Built as nodes, not markup: the country name comes from a downloaded file
  // and must never be parsed as HTML.
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if(text !== undefined) n.textContent = text;
    if(cls) n.className = cls;
    return n;
  };

  const qual = subjectQualifier();
  const line1 = `${subjectName()}${qual ? " · " + qual : ""} · ${outW.toLocaleString()} × ${outH.toLocaleString()} px`;
  const line2 = `${fmt(r.bb.lon0,"lon")} – ${fmt(lon1,"lon")} · ${fmt(r.bb.lat0,"lat")} – ${fmt(r.bb.lat1,"lat")}`;

  const out = $("readout");
  out.replaceChildren(
    document.createTextNode(line1), el("br"),
    document.createTextNode(line2), el("br"),
    el("b", `${mpp.toFixed(0)} m/px`),
    document.createTextNode(" — ")
  );
  out.append(factor <= 1.15
    ? document.createTextNode("full native detail")
    : el("span", `${factor.toFixed(1)}× upscaled from ${native} m data`, "warn"));

  if(r.offCentre){
    out.append(el("br"), el("span", "frame clipped at the projection's latitude limit — country is off-centre", "warn"));
  }
}

/* ═══════════════════════════════════════════════════════════
   Export
   ═══════════════════════════════════════════════════════════ */

function filename(ext, suffix){
  const l = isNight() ? "night" : "day";
  const tail = (suffix ? "-" + suffix : "") + "." + ext;
  if($("revealName").checked){
    return current.name.toLowerCase().replace(/[^a-z0-9]+/g,"-") + "-" + l + tail;
  }
  let hash = 0;
  const seed = current.name + l + $("layer").value;
  for(let i = 0; i < seed.length; i++) hash = (hash*31 + seed.charCodeAt(i)) >>> 0;
  return "clue-" + hash.toString(36).slice(0,6) + "-" + l + tail;
}

function saveCanvas(canvas, type, ext, suffix){
  return new Promise((res, rej) => {
    canvas.toBlob(blob => {
      if(!blob) return rej(new Error("encode failed"));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename(ext, suffix);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      res();
    }, type, 0.94);
  });
}

async function exportImage(type, ext){
  if(tainted){
    note("In-page export is blocked in this browser. Use “Copy image URL” instead.", true);
    return;
  }
  const btn = ext === "png" ? $("dlPng") : $("dlJpg");
  const label = btn.textContent;
  btn.textContent = "Rendering…"; btn.disabled = true;

  renderBar(0);

  try {
    const spec   = frameSpec();
    const cap    = captionSpec();
    const credit = creditSpec();
    const base   = document.createElement("canvas");

    await render(base, imagerySpec(spec, cap, credit), p => renderBar(p));

    const hasText = cap || (credit && credit.text);

    if(!hasText){
      await saveCanvas(base, type, ext);
    } else {
      await ensureFont(Math.round(spec.H * (cap ? cap.frac : 0.016)));
      const withText = composeText(base, cap, credit, spec.mode === "fixed" ? spec : null);
      const pair = $("pairExport").checked;
      await saveCanvas(withText, type, ext, pair ? "caption" : "");

      if(pair){
        // Browsers commonly prompt before a page saves a second file.
        await new Promise(r => setTimeout(r, 400));
        if(spec.mode === "fixed" && bandHeightFor(spec, cap, credit) > 0){
          // A band inside a fixed frame shrank the picture, so a full-frame
          // clean copy is genuinely different imagery and needs its own pass.
          const clean = document.createElement("canvas");
          await render(clean, spec, p => renderBar(p));
          await saveCanvas(clean, type, ext);
        } else {
          await saveCanvas(base, type, ext);
        }
      }
    }
    note("");
  } catch (e) {
    note("Export failed while fetching imagery. Try a smaller frame, or a different date.", true);
  } finally {
    btn.textContent = label; btn.disabled = false;
    renderBar(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Country search
   ═══════════════════════════════════════════════════════════ */

let matches = [], cursor = 0;

const fmtPop = p => p >= 1e6 ? (p/1e6).toFixed(1).replace(/\.0$/,"") + "M"
                  : p >= 1e3 ? Math.round(p/1e3) + "k" : String(p || "");

/*
  "springfield, illinois" or "springfield, us" narrows by subdivision or
  country — the qualifier after the comma is matched against both.
*/
function search(q){
  const raw = String(q || "");
  const [head, ...rest] = raw.split(",");
  const n = norm(head);
  const qual = norm(rest.join(" "));
  if(!n) return [];

  if(!isCity()){
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
                 .slice(0, 8).map(s => s.c);
  }

  const scored = [];
  for(const c of CITIES){
    const name = norm(c.name), ascii = norm(c.ascii);
    let score = -1;
    if(name === n || ascii === n) score = 0;
    else if(name.startsWith(n) || ascii.startsWith(n)) score = 1;
    else if(name.includes(n) || ascii.includes(n)) score = 2;
    if(score < 0) continue;

    if(qual){
      const hay = norm(c.region + " " + c.country + " " + c.iso);
      const expanded = own(US_STATES, qual);
      if(!hay.includes(qual) && !(expanded && hay.includes(expanded))) continue;
    }
    scored.push({c, score});
  }
  // Population breaks ties, so the Springfield people mean comes first.
  return scored.sort((a,b) => a.score - b.score || b.c.pop - a.c.pop)
               .slice(0, 10).map(s => s.c);
}

function renderResults(){
  const nodes = matches.map((c,i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.i = String(i);
    if(i === cursor) b.className = "on";
    b.textContent = c.name;                       // never markup
    if(isCity()){
      const bits = [c.region, c.country].filter(Boolean).join(" · ");
      const meta = document.createElement("small");
      meta.textContent = [bits, fmtPop(c.pop), c.wikidata ? "from Wikidata" : ""]
        .filter(Boolean).join("  ");
      b.append(meta);
    }
    return b;
  });

  /*
    Offered even when the local list found something: a name can exist in
    Natural Earth and still be the wrong place. Touba is in the data as the
    Ivorian town, while the Senegalese city of a million people is not — so a
    hit is no evidence the search is finished.
  */
  if(isCity() && wikidataOffer){
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.wd = "1";
    if(cursor === matches.length) b.className = "on";
    b.textContent = wikidataBusy
      ? `Searching Wikidata for “${wikidataOffer}”…`
      : matches.length
        ? `Also search Wikidata for “${wikidataOffer}”`
        : `Not here — search Wikidata for “${wikidataOffer}”`;
    const meta = document.createElement("small");
    meta.textContent = matches.length
      ? "Natural Earth leaves out many large places, so there may be more"
      : "Natural Earth carries about 7,300 places and leaves out many large ones";
    b.append(meta);
    nodes.push(b);
  }
  $("results").replaceChildren(...nodes);
}

let wikidataOffer = "", wikidataBusy = false;

/* The same settlement under two sources: same name, near enough the same spot. */
function sameCity(a, b){
  if(norm(a.name) !== norm(b.name)) return false;
  return Math.abs(a.lat - b.lat) < 0.25 && Math.abs(a.lon - b.lon) < 0.25;
}

async function runWikidataSearch(){
  if(!wikidataOffer || wikidataBusy) return;
  wikidataBusy = true;
  renderResults();
  try {
    const found = await searchWikidataCities(wikidataOffer);
    const [, ...rest] = String($("q").value || "").split(",");
    const qual = norm(rest.join(" "));
    const kept = qual
      ? found.filter(c => norm(c.region + " " + c.country + " " + c.iso).includes(qual))
      : found;

    // Keep what Natural Earth already gave, since those carry urban
    // footprints, and add only the places it did not have.
    const existing = matches.slice();
    const fresh = kept.filter(w => !existing.some(c => sameCity(c, w)));
    matches = existing.concat(fresh).slice(0, 14);
    cursor = existing.length < matches.length ? existing.length : 0;
    /*
      Four different outcomes hide behind "no new results", and which one it
      was decides what to try next: a different spelling, a different
      qualifier, or nothing at all.
    */
    const term = wikidataOffer;
    if(fresh.length){
      note(`Wikidata added ${fresh.length} more ${fresh.length === 1 ? "place" : "places"} for “${term}”.`);
    } else if(!found.length){
      note(existing.length
        ? `Wikidata has no settlement called “${term}” either, so the ${existing.length === 1 ? "one above is" : "ones above are"} all there is.`
        : `Neither Natural Earth nor Wikidata has a settlement called “${term}”. A different spelling may find it.`, !existing.length);
    } else if(!kept.length){
      note(`Wikidata found ${found.length} ${found.length === 1 ? "place" : "places"} called “${term}”, but ${found.length === 1 ? "it is not" : "none of them is"} in “${rest.join(",").trim()}”. Dropping the part after the comma would show ${found.length === 1 ? "it" : "them"}.`, !existing.length);
    } else {
      note(`Wikidata knows “${term}” but adds nothing new — everything it has is already listed above.`);
    }
    wikidataOffer = "";
  } catch (e) {
    note("The Wikidata lookup failed: " + cleanName(e && e.message, 60) + ".", true);
  } finally {
    wikidataBusy = false;
    renderResults();
  }
}

/* Carrying 3× from Liechtenstein to Russia would be a surprise, and carrying
   a city's tight crop over to a whole country is worse. */
function resetFraming(){
  $("pad").value = "108";
  $("nudgeX").value = "0";
  $("nudgeY").value = "0";
}

function pick(c){
  if(!c) return;
  resetFraming();
  current = c;
  $("q").value = c.name;
  matches = []; wikidataOffer = ""; renderResults();
  // Say where a place came from when it did not come from the usual source.
  note(c.wikidata
    ? `“${c.name}” is not in Natural Earth; its position and population come from Wikidata (${c.wikidata}). No urban footprint is available, so the frame is sized from population.`
    : "");
  syncFraming();
  updatePreview();
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

$("q").addEventListener("input", e => {
  matches = search(e.target.value); cursor = 0;
  const head = String(e.target.value || "").split(",")[0].trim();
  // Offered on any city search long enough to be meaningful, found or not.
  wikidataOffer = (isCity() && head.length >= 3 && CITIES.length) ? head : "";
  renderResults();
});
$("q").addEventListener("keydown", e => {
  // The Wikidata offer is a row like any other, so it has to be counted for
  // the arrow keys — and with no matches at all it is the only row there is.
  const rows = matches.length + (wikidataOffer ? 1 : 0);
  if(!rows) return;
  if(e.key === "ArrowDown"){ cursor = (cursor+1) % rows; renderResults(); e.preventDefault(); }
  if(e.key === "ArrowUp"){ cursor = (cursor-1+rows) % rows; renderResults(); e.preventDefault(); }
  if(e.key === "Enter"){
    if(wikidataOffer && cursor === matches.length) runWikidataSearch();
    else if(matches[cursor]) pick(matches[cursor]);
    e.preventDefault();
  }
  if(e.key === "Escape"){ matches = []; wikidataOffer = ""; renderResults(); }
});
$("results").addEventListener("click", e => {
  const b = e.target.closest("button");
  if(!b) return;
  if(b.dataset.wd === "1") runWikidataSearch();
  else pick(matches[+b.dataset.i]);
});

/*
  City mode hides what doesn't apply: Equal Earth is indistinguishable from
  Mercator across 40 km, and the GIBS reference vectors are generalised for
  global scale so they sit visibly wrong over a city.
*/
function syncModeUI(){
  const city = isCity();
  $("outlineLabel").textContent = city ? "Built-up area outline" : "Country outline";
  $("segMain").textContent = city ? "City core" : "Mainland";
  $("segFull").textContent = city ? "Metro area" : "Full extent";
  $("rowCoast").hidden = city;
  $("rowFeat").hidden  = city;
  $("ovOutline").disabled = city && !URBAN.length;

  /*
    A city frame spans tens of kilometres, where the three projections differ
    by a fraction of a percent. Offering the choice would be noise, and naming
    the projection on the image would be noise on the image, so city mode is
    Mercator and says nothing about it.
  */
  $("eqearthOpt").hidden = city;
  $("projField").hidden = city;
  $("projCreditRow").hidden = city;
  if(city) $("proj").value = "3857";
  $("q").placeholder = city
    ? (CITIES.length ? CITIES.length + " places — try “springfield, illinois”" : "Loading places…")
    : (COUNTRIES.length ? COUNTRIES.length + " countries — start typing" : "Loading country outlines…");
}

async function setMode(city){
  setSeg(city ? $("modeCity") : $("modeCountry"), city ? $("modeCountry") : $("modeCity"));
  current = null;
  matches = []; renderResults();
  $("q").value = "";

  // Metro reads better than the bare core at the resolutions available here;
  // countries still open on the mainland.
  if(city) setSeg($("segFull"), $("segMain"));
  else     setSeg($("segMain"), $("segFull"));

  // A caption written for a country rarely suits a city, and vice versa.
  $("capText").value = "";
  syncCaptionUI();
  resetFraming();
  syncFraming();

  fillLayers();
  syncSourceUI();
  syncCaptionUI();
  $("preview").style.display = "none";
  $("empty").style.display = "block";
  $("readout").replaceChildren();
  ["dlPng","dlJpg","copyUrl"].forEach(id => $(id).disabled = true);
  syncModeUI();

  if(city && !CITIES.length){
    $("q").disabled = true;
    note("");
    progress("Starting", null);
    try {
      await loadCities();
      note(urbanFallbackNote);
      if(urbanFallbackNote){ $("ovOutline").checked = false; }
    } catch (e) {
      const detail = Array.isArray(e && e.tried) ? " Tried: " + e.tried.join("; ") + "." : "";
      note("Couldn't load the place data." + detail + " Switch back to City to retry.", true);
      $("q").disabled = false;
      return;
    } finally {
      progress(null);
      $("q").disabled = false;
    }
  }
  syncModeUI();
  $("q").focus();
}

$("modeCountry").addEventListener("click", () => setMode(false));
$("modeCity").addEventListener("click", () => setMode(true));

/*
  Sentinel-2 is CC BY-NC-SA, so its credit is not optional. Naming the
  projection is a separate choice and stays yours: the licence obliges the
  attribution, not the cartography note that used to ride along with it.
*/
function syncSourceUI(){
  const l = currentLayer();
  const nc = !!l.attribution;
  $("creditLabel").textContent = "Name the projection, bottom right";
  $("attribNotice").hidden = !nc;
  $("attribNotice").textContent = nc
    ? "This source is CC BY-NC-SA, so its credit is drawn on the image whether or not the projection is named."
    : "";
  if(nc) note("Sentinel-2 cloudless is EOX's free fair-use tier: fine for making images, not for production traffic. The attribution is baked into the export.");
}

$("segDay").addEventListener("click", () => { setSeg($("segDay"), $("segNight")); fillLayers(); syncSourceUI(); syncCaptionUI(); applyCaptionDefault(); updatePreview(); });
$("segNight").addEventListener("click", () => { setSeg($("segNight"), $("segDay")); fillLayers(); syncSourceUI(); syncCaptionUI(); applyCaptionDefault(); updatePreview(); });
$("segMain").addEventListener("click", () => { setSeg($("segMain"), $("segFull")); updatePreview(); });
$("segFull").addEventListener("click", () => { setSeg($("segFull"), $("segMain")); updatePreview(); });

$("layer").addEventListener("change", () => { syncDateField(); syncSourceUI(); syncCaptionUI(); updatePreview(); });
$("date").addEventListener("change", updatePreview);
$("proj").addEventListener("change", updatePreview);

let padTimer;
function syncFraming(){
  const f = (+$("pad").value || 100) / 100;
  $("padOut").textContent = f.toFixed(2) + "×";
  const bb = subjectBBox();
  if(bb){
    const km = (bb.lon1 - bb.lon0) * 111.32 * Math.cos((bb.lat0 + bb.lat1) / 2 * Math.PI / 180) * f;
    $("padOut2").textContent = km > 0 ? `${km >= 1000 ? Math.round(km/10)*10 : Math.round(km)} km across` : "";
  } else $("padOut2").textContent = "";

  const nx = +$("nudgeX").value || 0, ny = +$("nudgeY").value || 0;
  $("nudgeXOut").textContent = nx === 0 ? "centred" : `${Math.abs(nx)}% ${nx > 0 ? "east" : "west"}`;
  $("nudgeYOut").textContent = ny === 0 ? "centred" : `${Math.abs(ny)}% ${ny > 0 ? "north" : "south"}`;
}

/*
  Framing tighter than the source's own resolution does not reveal anything —
  the pixels are enlarged, not sharpened. Worth saying, since the remedy is
  usually a different layer rather than a different frame.
*/
function detailWarning(){
  const bb = subjectBBox();
  if(!bb) return "";
  const layer = currentLayer();
  if(!layer || !isNum(layer.res)) return "";
  const spec = frameSpec();
  const px = spec.mode === "fixed" ? spec.W : (spec.W || 2400);
  if(!isNum(px) || px <= 0) return "";

  const f = Math.max(0.05, (+$("pad").value || 100) / 100);
  const widthM = (bb.lon1 - bb.lon0) * 111320 *
                 Math.cos((bb.lat0 + bb.lat1) / 2 * Math.PI / 180) * f;
  if(!(widthM > 0)) return "";
  const asked = widthM / px;
  if(asked >= layer.res) return "";
  return `This framing asks for about ${asked < 10 ? asked.toFixed(1) : Math.round(asked)} m per pixel, ` +
         `but ${layer.name.split(" — ")[0]} holds ${layer.res} m — the rest is enlargement, not detail. ` +
         `A finer source would show more.`;
}

$("pad").addEventListener("input", () => {
  syncFraming();
  clearTimeout(padTimer);
  padTimer = setTimeout(updatePreview, 280);
});
["nudgeX","nudgeY"].forEach(id => $(id).addEventListener("input", () => {
  syncFraming();
  clearTimeout(padTimer);
  padTimer = setTimeout(updatePreview, 280);
}));

["ovOutline","ovCoast","ovFeat"].forEach(id =>
  $(id).addEventListener("change", updatePreview));

/* ── frame ── */
function syncFrameUI(){
  const v = $("frame").value;
  $("customSize").hidden = v !== "custom";
  $("fillField").hidden  = v.startsWith("fit:");
}
$("frame").addEventListener("change", () => { syncFrameUI(); updatePreview(); });
$("fillImg").addEventListener("click",  () => { setSeg($("fillImg"), $("fillBars")); updatePreview(); });
$("fillBars").addEventListener("click", () => { setSeg($("fillBars"), $("fillImg")); updatePreview(); });

let sizeTimer;
["customW","customH"].forEach(id => $(id).addEventListener("input", () => {
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(updatePreview, 400);
}));

/* ── caption ── */
function syncCaptionUI(){
  const hasText = !!cleanCaption($("capText").value);
  const credit  = $("showProj").checked || !!currentLayer().attribution;
  $("capTextOpts").hidden   = !hasText;
  $("capColorField").hidden = !hasText;
  $("creditOpts").hidden    = !credit;
  $("pairRow").hidden       = !(hasText || credit);
}

let capTimer;
$("capText").addEventListener("input", () => {
  syncCaptionUI();
  clearTimeout(capTimer);
  capTimer = setTimeout(updatePreview, 350);
});
$("capTop").addEventListener("click",     () => { setSeg($("capTop"), $("capBottom")); updatePreview(); });
$("capBottom").addEventListener("click",  () => { setSeg($("capBottom"), $("capTop")); updatePreview(); });
$("capOverlay").addEventListener("click", () => { setSeg($("capOverlay"), $("capBand")); updatePreview(); });
$("capBand").addEventListener("click",    () => { setSeg($("capBand"), $("capOverlay")); updatePreview(); });
$("capColor").addEventListener("input", () => { capColourTouched = true; updatePreview(); });
$("showProj").addEventListener("change", () => { syncCaptionUI(); updatePreview(); });
$("crdOverlay").addEventListener("click", () => { setSeg($("crdOverlay"), $("crdBand")); updatePreview(); });
$("crdBand").addEventListener("click",    () => { setSeg($("crdBand"), $("crdOverlay")); updatePreview(); });
$("crdColor").addEventListener("input", () => { crdColourTouched = true; updatePreview(); });
$("capSize").addEventListener("input", e => {
  $("capSizeOut").textContent = (+e.target.value / 10).toFixed(1) + "%";
  clearTimeout(capTimer);
  capTimer = setTimeout(updatePreview, 250);
});

/* Text colour follows the imagery unless the user has picked one. */
function applyCaptionDefault(){
  const preset = isNight() ? CAPTION_DEFAULT.night : CAPTION_DEFAULT.day;
  if(!capColourTouched) $("capColor").value = preset;
  if(!crdColourTouched) $("crdColor").value = preset;
}

$("dlPng").addEventListener("click", () => exportImage("image/png","png"));
$("dlJpg").addEventListener("click", () => exportImage("image/jpeg","jpg"));

$("copyUrl").addEventListener("click", async () => {
  if(!current) return;
  const crs = $("proj").value;
  const bb  = subjectBBox();
  if(!bb) return;
  const box = planeBox(bb, crs, +$("pad").value, nudgeX(), nudgeY());
  const spec = frameSpec();
  const H = spec.mode === "fixed" ? spec.H : spec.H;
  const W = spec.mode === "fixed"
    ? spec.W
    : Math.round(H * (box.x1-box.x0)/(box.y1-box.y0));
  const url = wmsUrl(crs, box, W, H, activeLayerIds(), currentLayer().dated ? $("date").value : "");
  try {
    await navigator.clipboard.writeText(url);
    note(W > 4096
      ? `Image URL copied, but it asks for ${W} px across in one request — GIBS may refuse it. A smaller export height will help.`
      : "Image URL copied. Countries that cross the dateline get clipped in this single-request form.");
  } catch(e){
    window.prompt("Copy this URL:", url);
  }
});

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

fillLayers();
syncFrameUI();
syncSourceUI();
syncCaptionUI();
applyCaptionDefault();
syncModeUI();

fetch(TOPO_URL)
  .then(r => { if(!r.ok) throw new Error("http " + r.status); return r.json(); })
  .then(topo => {
    COUNTRIES = topoToFeatures(topo, "countries").map(buildCountry).filter(Boolean)
                  .sort((a,b) => a.name.localeCompare(b.name));
    $("q").disabled = false;
    syncModeUI();
    $("q").focus();
  })
  .catch(() => {
    $("q").placeholder = "Country outlines unavailable";
    note("Couldn't reach the country outline data on jsDelivr. Check your connection and reload — the app needs it once at start-up to work out where each country is.", true);
  });
