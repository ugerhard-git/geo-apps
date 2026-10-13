/**
 * Geo imagery — settings, imagery layers and fixed data.
 */

/* ═══════════════════════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════════════════════ */

export const GIBS = {
  3857: "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi",
  4326: "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
};

/* EOX serves EPSG:4326 only; other projections are resampled here. */
export const EOX_WMS = "https://tiles.maps.eox.at/wms";
export const EOX_ATTRIBUTION = (y) =>
  `Sentinel-2 cloudless ${y} by EOX IT Services GmbH (modified Copernicus Sentinel data), CC BY-NC-SA 4.0`;

// nativeRes = metres per pixel of the underlying data
export const LAYERS = {
  night: [
    { id: "VIIRS_Black_Marble", name: "Black Marble — clean composite", res: 500, dated: false },
    { id: "VIIRS_CityLights_2012", name: "Earth at Night 2012", res: 500, dated: false },
  ],
  day: [
    {
      id: "BlueMarble_ShadedRelief_Bathymetry",
      name: "Blue Marble — relief, cloud-free",
      res: 500,
      dated: false,
    },
    {
      id: "BlueMarble_NextGeneration",
      name: "Blue Marble — natural, cloud-free",
      res: 500,
      dated: false,
    },
    {
      id: "MODIS_Terra_CorrectedReflectance_TrueColor",
      name: "MODIS — single day, has clouds",
      res: 250,
      dated: true,
      from: "2000-02-24",
    },
    {
      id: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
      name: "VIIRS — single day, has clouds",
      res: 250,
      dated: true,
      from: "2015-11-24",
    },
  ],
};

/*
  Sentinel-2 cloudless from EOX: 10 m and recent, but CC BY-NC-SA, so it is
  non-commercial and the attribution has to travel with the exported image.
  Their free tier is fair-use — fine for authoring, not for production traffic.
*/
for (const year of [2024, 2023, 2022, 2021, 2020]) {
  LAYERS.day.push({
    id: "s2cloudless-" + year,
    name: `Sentinel-2 cloudless ${year} — 10 m`,
    res: 10,
    dated: false,
    host: "eox",
    only4326: true,
    attribution: EOX_ATTRIBUTION(year),
  });
}

/*
  GIBS vector layers ship a mapbox-gl style and are typeset by the client.
  The WMS endpoint rasterises them with a server-side default style, which
  draws geometry but not text — so Reference_Labels_15m yields anchor points
  with no names and isn't offered here. Rendering it properly would mean
  parsing MVT tiles and placing the type ourselves.
*/
export const OVERLAY_LAYERS = {
  ovCoast: "Coastlines_15m",
  ovFeat: "Reference_Features_15m",
};

export const OVERLAY_LABEL = {
  Coastlines_15m: "coastlines",
  Reference_Features_15m: "borders and rivers",
};

export const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";
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
export const PLACES_URLS = [
  {
    url: "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_populated_places_simple.geojson",
    bytes: 4_700_000,
  },
  {
    url: "https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/cultural/ne_10m_populated_places_simple.json",
  },
  {
    url: "https://cdn.jsdelivr.net/npm/natural-earth-vector@5/geojson/ne_10m_populated_places_simple.geojson",
    bytes: 4_700_000,
  },
  {
    url: "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_populated_places_simple.geojson",
  },
];

/* Optional: built-up footprints. Without them a population model stands in. */
export const URBAN_URLS = [
  {
    url: "https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/10m/cultural/ne_10m_urban_areas.json",
  },
  {
    url: "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_urban_areas.geojson",
  },
  { url: "https://cdn.jsdelivr.net/npm/natural-earth-vector@5/geojson/ne_10m_urban_areas.geojson" },
];
export const CITY_MIN_KM = 12; // floor so a small town isn't zoomed absurdly
export const METRO_MULT = 2.0; // metro framing relative to the built-up core
export const NIGHT_MIN_KM = 90; // night data is 500 m; tight framing is pointless
export const MAX_SUB = 2048; // largest single WMS request edge
export const PREVIEW_H = 620;
export const MAX_PIXELS = 48e6;

/*
  Natural Earth stores subdivisions by full name, but people type the
  abbreviation — "springfield, il" far more often than "springfield, illinois".
*/
export const US_STATES = {
  al: "alabama",
  ak: "alaska",
  az: "arizona",
  ar: "arkansas",
  ca: "california",
  co: "colorado",
  ct: "connecticut",
  de: "delaware",
  fl: "florida",
  ga: "georgia",
  hi: "hawaii",
  id: "idaho",
  il: "illinois",
  in: "indiana",
  ia: "iowa",
  ks: "kansas",
  ky: "kentucky",
  la: "louisiana",
  me: "maine",
  md: "maryland",
  ma: "massachusetts",
  mi: "michigan",
  mn: "minnesota",
  ms: "mississippi",
  mo: "missouri",
  mt: "montana",
  ne: "nebraska",
  nv: "nevada",
  nh: "new hampshire",
  nj: "new jersey",
  nm: "new mexico",
  ny: "new york",
  nc: "north carolina",
  nd: "north dakota",
  oh: "ohio",
  ok: "oklahoma",
  or: "oregon",
  pa: "pennsylvania",
  ri: "rhode island",
  sc: "south carolina",
  sd: "south dakota",
  tn: "tennessee",
  tx: "texas",
  ut: "utah",
  vt: "vermont",
  va: "virginia",
  wa: "washington",
  wv: "west virginia",
  wi: "wisconsin",
  wy: "wyoming",
  dc: "district of columbia",
};

/* Alternate names people actually type, including German. */
export const ALIASES = {
  "United States of America": ["usa", "us", "united states", "amerika", "vereinigte staaten"],
  "United Kingdom": [
    "uk",
    "great britain",
    "britain",
    "england",
    "grossbritannien",
    "großbritannien",
  ],
  Germany: ["deutschland", "brd"],
  Netherlands: ["holland", "niederlande"],
  Switzerland: ["schweiz", "suisse", "helvetia"],
  Austria: ["oesterreich", "österreich"],
  Czechia: ["czech republic", "tschechien"],
  Italy: ["italien", "italia"],
  France: ["frankreich"],
  Spain: ["spanien", "espana", "españa"],
  Sweden: ["schweden", "sverige"],
  Norway: ["norwegen", "norge"],
  Denmark: ["daenemark", "dänemark"],
  Finland: ["finnland", "suomi"],
  Poland: ["polen", "polska"],
  Greece: ["griechenland", "hellas"],
  Hungary: ["ungarn", "magyarorszag"],
  Croatia: ["kroatien", "hrvatska"],
  Turkey: ["tuerkei", "türkei", "turkiye"],
  Russia: ["russland", "russian federation"],
  China: ["prc", "peoples republic of china"],
  Japan: ["nippon", "nihon"],
  "South Korea": ["korea", "republic of korea", "suedkorea", "südkorea"],
  "North Korea": ["dprk", "nordkorea"],
  Egypt: ["aegypten", "ägypten", "misr"],
  Morocco: ["marokko", "maghreb"],
  "South Africa": ["suedafrika", "südafrika", "rsa"],
  Belgium: ["belgien"],
  Ireland: ["irland", "eire"],
  Iceland: ["island"],
  Portugal: ["portugal"],
  Brazil: ["brasilien", "brasil"],
  Mexico: ["mexiko"],
  Argentina: ["argentinien"],
  India: ["indien", "bharat"],
  Australia: ["australien"],
  "New Zealand": ["neuseeland", "aotearoa"],
  Canada: ["kanada"],
  Ukraine: ["ukraine"],
  Romania: ["rumaenien", "rumänien"],
  Bulgaria: ["bulgarien"],
  Serbia: ["serbien"],
  Slovakia: ["slowakei"],
  Slovenia: ["slowenien"],
  Lithuania: ["litauen"],
  Latvia: ["lettland"],
  Estonia: ["estland"],
  "Saudi Arabia": ["saudi arabien"],
  Thailand: ["siam"],
  Vietnam: ["viet nam"],
  Indonesia: ["indonesien"],
  Philippines: ["philippinen"],
  Nigeria: ["nigeria"],
  Kenya: ["kenia"],
  Ethiopia: ["aethiopien", "äthiopien"],
  Israel: ["israel"],
  Iran: ["persia", "persien"],
  Iraq: ["irak"],
  "Cote d'Ivoire": ["ivory coast", "elfenbeinkueste"],
  "Czech Republic": ["tschechien"],
};
