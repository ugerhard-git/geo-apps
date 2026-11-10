/**
 * Cross-sections — the land along a straight line across a country, drawn
 * as a profile with no names: the rise of its mountains and the width of
 * its plains are the clue.
 *
 * Flow: CLDR names fill the picker and world-atlas supplies the outlines →
 * pick a country → find where the line runs: through the capital (from the
 * GeoNames city list, loaded the first time it's needed), the middle, or
 * the highest point (a coarse search over the country's heights) → cut the
 * line where it leaves the country (profile.js) → load the elevation tiles
 * along it (shared/terrain-tiles.js) → read the heights and draw
 * (render.js) → export.
 *
 * The profile is kept, so changing colours, labels or the scale only
 * repaints; changing the country, the direction or what the line runs
 * through reads it again.
 *
 *   config.js   the shared scale, how many points and tiles
 *   profile.js  the line, the points along it and their heights (pure)
 *   render.js   drawing the sheet
 *   presets.js  examples to start from, and how a look colours the sheet
 *   welcome.js  the text of the welcome window
 */

import { addBackLink } from "../../shared/back-link.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, progress, setSeg } from "../../shared/dom.js";
import { GEONAMES_CREDIT, loadCities } from "../../shared/geonames.js";
import { ALIASES, loadMapCountries } from "../../shared/map-countries.js";
import { setupPresets } from "../../shared/presets.js";
import { mainlandPolys } from "../../shared/projection.js";
import { canvasToBlob, downloadBlob, frameSpec, hashSlug } from "../../shared/sheet.js";
import {
  MAX_ZOOM,
  TERRAIN_ATTRIBUTION_URL,
  TERRAIN_CREDIT,
  cachedTile,
  ensureTiles,
} from "../../shared/terrain-tiles.js";
import { cleanText, slugify } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import { setupWelcome } from "../../shared/welcome.js";
import { boxOfPolys, landArea } from "../../shared/world.js";
import {
  GRID_COLUMNS,
  MAX_GRID_TILES,
  MAX_GRID_ZOOM,
  MAX_LINE_TILES,
  SAMPLES,
  SHARED_TOP_M,
} from "./config.js";
import { EXAMPLES, MIN_RANDOM_AREA, lookToControls } from "./presets.js";
import {
  gridPoints,
  heightScale,
  highestPoint,
  insideIntervals,
  lineZoom,
  middleOf,
  pointTileKeys,
  readProfile,
  samplePoints,
  unwrapPolys,
} from "./profile.js";
import { drawSheet } from "./render.js";
import { WELCOME } from "./welcome.js";

// What the app does and how it works: opens by itself on the first visit.
setupWelcome("cross-sections", WELCOME);

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Territory */
/** @typedef {import("../../shared/world.js").CountryShape} CountryShape */
/** @typedef {import("../../shared/world.js").Polys} Polys */
/** @typedef {import("../../shared/geonames.js").City} City */
/** @typedef {import("./profile.js").Direction} Direction */
/** @typedef {import("./profile.js").Profile} Profile */
/** @typedef {"capital" | "middle" | "highest"} Through */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Territory[]} */
let COUNTRIES = [];
/** @type {(t: Territory) => CountryShape | null} */
let shapeFor = () => null;

/** @type {Territory | null} */
let chosen = null;
/** The chosen country's mainland, on one side of the antimeridian. @type {Polys} */
let land = [];

/**
 * The line last read, and what it was read for.
 *
 * @typedef {object} Line
 * @property {string} key country, direction and what it runs through
 * @property {Direction} dir
 * @property {Through} through what it actually runs through (the middle, if the asked-for point missed)
 * @property {Profile} profile
 * @property {string} fallback why it doesn't run through what was asked, "" if it does
 */
/** @type {Line | null} */
let line = null;

/** The GeoNames city list, once asked for. @type {Promise<Map<string, City[]>> | null} */
let citiesLoading = null;

/** Incremented per redraw, so a slow one can't overwrite a newer one. */
let request = 0;

/** @returns {Direction} */
const direction = () => (isPressed("dirSN") ? "sn" : "we");
/** @returns {Through} */
const through = () => {
  const v = $("through").value;
  return v === "middle" || v === "highest" ? v : "capital";
};

/** Wording for the sheet and the panels. */
const DIR_TEXT = { we: "West to east", sn: "South to north" };
const ENDS = { we: ["West", "East"], sn: ["South", "North"] };
const THROUGH_TEXT = {
  capital: "through the capital",
  middle: "through the middle",
  highest: "over the highest point",
};

/* ═══════════════════════════════════════════════════════════
   Finding the line
   ═══════════════════════════════════════════════════════════ */

/**
 * The city list, loaded the first time a capital is needed. A failed load
 * is forgotten, so the next try starts afresh.
 *
 * @param {(label: string) => void} say
 */
function cities(say) {
  if (!citiesLoading) {
    citiesLoading = loadCities((frac) =>
      say(
        frac === undefined
          ? "Loading the capitals"
          : `Loading the capitals · ${Math.round(frac * 100)}%`,
      ),
    ).catch((e) => {
      citiesLoading = null;
      throw e;
    });
  }
  return citiesLoading;
}

/**
 * The country's highest ground, from a coarse grid of heights.
 *
 * @param {(label: string) => void} say
 * @param {() => boolean} stale
 * @returns {Promise<[number, number] | null>}
 */
async function findHighest(say, stale) {
  const box = boxOfPolys(land);
  if (!box) return null;
  const midLat = ((box.s + box.n) / 2) * (Math.PI / 180);
  const wide = Math.max(1e-6, (box.e - box.w) * Math.cos(midLat));
  const rows = Math.max(12, Math.min(160, Math.round((GRID_COLUMNS * (box.n - box.s)) / wide)));
  const grid = gridPoints(land, box, rows, GRID_COLUMNS);
  if (!grid.length) return null;
  const asSamples = grid.map(([lon, lat]) => ({ lon, lat, km: 0, run: 0 }));
  let z = MAX_GRID_ZOOM;
  while (z > 0 && pointTileKeys(asSamples, z).length > MAX_GRID_TILES) z--;
  await ensureTiles(
    pointTileKeys(asSamples, z),
    (done, total) => say(`Looking for the highest point · ${done} of ${total} tiles`),
    stale,
  );
  return stale() ? null : highestPoint(grid, z, cachedTile);
}

/**
 * Where the line runs, and the reason when it can't run where asked.
 *
 * @param {Direction} dir
 * @param {Through} want
 * @param {(label: string) => void} say
 * @param {() => boolean} stale
 * @returns {Promise<{value: number, parts: import("./profile.js").Interval[], through: Through, fallback: string} | null>}
 */
async function placeLine(dir, want, say, stale) {
  /** @type {[number, number] | null} */
  let at = null;
  let fallback = "";
  if (want === "capital" && chosen) {
    const list = (await cities(say)).get(chosen.code) || [];
    const city = list.find((c) => c.capital) || list[0];
    if (city) at = [city.lon, city.lat];
    else
      fallback = "GeoNames has no capital for this country, so the line runs through its middle.";
  } else if (want === "highest") {
    at = await findHighest(say, stale);
    if (!at && !stale())
      fallback = "Couldn't find the highest point, so the line runs through the middle.";
  }
  if (stale()) return null;
  /** @param {[number, number] | null} p */
  const cut = (p) => (p ? insideIntervals(land, dir, dir === "we" ? p[1] : p[0]) : []);
  let parts = cut(at);
  let used = want;
  if (at && !parts.length) {
    fallback = `A line ${THROUGH_TEXT[want]} misses the mainland, so it runs through the middle.`;
  }
  if (!parts.length) {
    at = middleOf(land);
    parts = cut(at);
    used = "middle";
  }
  if (!at || !parts.length) return null;
  return { value: dir === "we" ? at[1] : at[0], parts, through: used, fallback };
}

/**
 * Read the line for the current country and settings, unless it's the one
 * already read.
 *
 * @param {number} mine the request this belongs to
 * @returns {Promise<boolean>} false if it was overtaken or there is no line
 */
async function readLine(mine) {
  if (!chosen) return false;
  const dir = direction();
  const want = through();
  const key = `${chosen.code}|${dir}|${want}`;
  if (line && line.key === key) return true;
  const stale = () => mine !== request;
  const say = (/** @type {string} */ label) => {
    if (!stale()) working(label);
  };
  say("Finding the line");
  const placed = await placeLine(dir, want, say, stale);
  if (stale()) return false;
  if (!placed) {
    line = null;
    return false;
  }
  const points = samplePoints(dir, placed.value, placed.parts, SAMPLES);
  const z = lineZoom(points, MAX_ZOOM, MAX_LINE_TILES);
  const failed = await ensureTiles(
    pointTileKeys(points, z),
    (done, total) => say(`Loading the heights · ${done} of ${total} tiles`),
    stale,
  );
  if (stale()) return false;
  const profile = readProfile(points, z, cachedTile);
  if (failed) profile.missing = Math.max(profile.missing, 1);
  line = { key, dir, through: placed.through, profile, fallback: placed.fallback };
  return true;
}

/* ═══════════════════════════════════════════════════════════
   Drawing
   ═══════════════════════════════════════════════════════════ */

/**
 * The sheet's options from the controls, for the line that was read.
 *
 * @param {Line} l
 * @returns {import("./render.js").SheetOptions}
 */
function sheetOptions(l) {
  const { W, H } = frameSpec();
  const stretch = $("optStretch").checked;
  const scale = heightScale(l.profile.min, l.profile.max, stretch, SHARED_TOP_M);
  const parts = [
    $("optName").checked && chosen ? chosen.name : "",
    `${DIR_TEXT[l.dir]} ${THROUGH_TEXT[l.through]}`,
    $("optLength").checked ? `${Math.round(l.profile.lengthKm).toLocaleString("en-GB")} km` : "",
  ];
  const scaleNote = !$("optScaleNote").checked
    ? ""
    : stretch
      ? `Heights stretched to fit: the highest point on the line is ${Math.round(l.profile.max).toLocaleString("en-GB")} m`
      : scale.bottom < 0
        ? `Heights on the same scale for every country, from ${scale.bottom.toLocaleString("en-GB")} m to ${scale.top.toLocaleString("en-GB")} m`
        : `Heights on the same scale for every country: sea level to ${scale.top.toLocaleString("en-GB")} m`;
  return {
    W,
    H,
    bg: safeColour($("bgColor").value, "#f6f2ea"),
    ink: safeColour($("capColor").value, "#23262d"),
    land: safeColour($("landColor").value, "#b4553a"),
    caption: cleanText($("capText").value, 120),
    subtitle: parts.filter(Boolean).join(" · "),
    footnote: [scaleNote, cleanText($("noteText").value, 160)].filter(Boolean).join(" · "),
    ends: $("optEnds").checked ? /** @type {[string, string]} */ (ENDS[l.dir]) : null,
    heights: $("optHeights").checked,
    distances: $("optDistances").checked,
    credit: $("optCredit").checked ? TERRAIN_CREDIT : "",
  };
}

/**
 * Draw the line that was read on `canvas`.
 *
 * @param {HTMLCanvasElement} canvas
 */
async function paint(canvas) {
  if (!line) return;
  const o = sheetOptions(line);
  // The canvas draws with whatever font is ready; wait for the sheet's own.
  await document.fonts.load(`500 40px "Space Grotesk"`).catch(() => {});
  drawSheet(
    canvas,
    o,
    line.profile,
    heightScale(line.profile.min, line.profile.max, $("optStretch").checked, SHARED_TOP_M),
  );
}

/* ═══════════════════════════════════════════════════════════
   Panels
   ═══════════════════════════════════════════════════════════ */

function renderSources() {
  const dl = $("sourceList");
  dl.replaceChildren();
  /**
   * @param {string} term
   * @param {string} href
   * @param {string} label
   */
  const row = (term, href, label) => {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label; // text, never markup
    dd.append(a);
    dl.append(dt, dd);
  };
  row(
    "Elevation",
    "https://registry.opendata.aws/terrain-tiles/",
    "Mapzen Terrain Tiles, on AWS Open Data",
  );
  row(
    "Elevation sources",
    TERRAIN_ATTRIBUTION_URL,
    "SRTM, GMTED2010, ETOPO1, EU-DEM and others — credits and licences",
  );
  row(
    "Border",
    "https://github.com/topojson/world-atlas",
    "Natural Earth admin-0, 1:50m, public domain — via world-atlas",
  );
  if (line?.through === "capital")
    row("Capital", "https://www.geonames.org/", GEONAMES_CREDIT.replace(/^Cities: /, ""));
  row("Country names", "https://cldr.unicode.org/", "Unicode CLDR");

  const caveats = [
    "The line follows one parallel or meridian, so it's a straight line on a map, and is cut where it leaves the mainland and the islands near it.",
    `Heights are read at about ${SAMPLES} points along it, so narrow peaks and gorges can come out a little lower or higher than they are.`,
  ];
  if (line?.through === "highest")
    caveats.push(
      "The highest point is found on a coarse grid of heights: the line crosses the highest ground, which may not be the summit itself.",
    );
  if (line?.fallback) caveats.push(line.fallback);
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !line;
}

/* ═══════════════════════════════════════════════════════════
   Picking
   ═══════════════════════════════════════════════════════════ */

const picker = createCountryPicker({
  items: () => COUNTRIES,
  forms: (c) => [c.name, ...c.alts, ...(own(ALIASES, c.code) || [])],
  code: (c) => c.code,
  label: (c) => c.name,
  onPick: pickCountry,
});

/** @param {Territory | undefined} c */
function pickCountry(c) {
  if (!c) return;
  chosen = c;
  const shape = shapeFor(c);
  land = shape ? unwrapPolys(mainlandPolys(shape.polys, shape.name)) : [];
  line = null;
  $("country").value = c.name;
  picker.close();
  note("");
  return refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

/**
 * Show the spinner over the sheet, with what is going on.
 *
 * @param {string} label
 */
function working(label) {
  $("busyLabel").textContent = label;
  $("busy").classList.add("on");
  $("view").classList.add("working");
}

function idle() {
  $("busy").classList.remove("on");
  $("view").classList.remove("working");
}

function hideSheet() {
  $("sheetWrap").hidden = true;
  $("empty").hidden = false;
}

/** Read the line if needed, and redraw the sheet. */
async function refresh() {
  syncUI();
  const mine = ++request;
  if (!chosen) {
    idle();
    hideSheet();
    $("sources").hidden = true;
    return;
  }
  if (!land.length) {
    idle();
    hideSheet();
    note(`There is no outline for ${chosen.name} at this scale, so there's no line to draw.`);
    return;
  }
  try {
    const ok = await readLine(mine);
    if (mine !== request) return;
    idle();
    if (!ok) {
      hideSheet();
      note(`No line across ${chosen.name} could be found. Try the other direction.`, true);
      return;
    }
    await paint($("sheet"));
    if (mine !== request) return;
    $("sheetWrap").hidden = false;
    $("empty").hidden = true;
    const p = /** @type {Line} */ (line).profile;
    note(
      p.missing
        ? "Some of the height tiles couldn't be loaded, so the profile has gaps. Reload to try again."
        : /** @type {Line} */ (line).fallback,
      p.missing > 0,
    );
    renderSources();
    syncUI();
  } catch (e) {
    if (mine !== request) return;
    idle();
    note(
      "Couldn't draw the line: " +
        cleanText(e && e.message, 80) +
        ". Check your connection and try again.",
      true,
    );
  }
}

/** Only repaint: the line stays the same. */
const repaint = debounce(async () => {
  if (!line) return refresh();
  syncUI();
  await paint($("sheet"));
}, 60);

/** Enable, disable and label the controls that depend on other controls. */
function syncUI() {
  const ready = !!line;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready;
  $("revealTag").hidden = !$("optName").checked;
  const t = through();
  $("throughHint").textContent =
    t === "capital"
      ? "The line runs through the capital, as GeoNames places it."
      : t === "middle"
        ? "The line runs through the centre of the country's area."
        : "The line runs over the country's highest ground.";
}

/**
 * Draw the sheet at full size and download it.
 *
 * @param {string} type MIME type
 * @param {string} ext file extension
 */
async function exportSheet(type, ext) {
  if (!chosen || !line) return;
  try {
    const canvas = document.createElement("canvas");
    await paint(canvas);
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The filename shouldn't give away what the picture is hiding.
    const slug = $("optName").checked ? slugify(chosen.name) : hashSlug(line.key + "|section");
    downloadBlob(blob, `cross-section-${slug || "sheet"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

for (const [on, off] of [
  ["dirWE", "dirSN"],
  ["dirSN", "dirWE"],
])
  $(on).addEventListener("click", () => {
    setSeg($(on), $(off));
    refresh();
  });
$("through").addEventListener("change", refresh);

for (const id of [
  "optStretch",
  "optScaleNote",
  "optHeights",
  "optDistances",
  "optEnds",
  "optLength",
  "optName",
  "optCredit",
])
  $(id).addEventListener("change", repaint);

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  repaint();
});
const repaintLater = debounce(() => repaint(), 400);
for (const id of ["customW", "customH", "capText", "noteText"])
  $(id).addEventListener("input", repaintLater);

bindColour("bgColor", "bgHex", repaint);
bindColour("landColor", "landHex", repaint);
bindColour("capColor", "capHex", repaint);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

async function start() {
  progress("Loading countries", true);
  try {
    const got = await loadMapCountries();
    COUNTRIES = got.territories;
    shapeFor = got.shapeFor;
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — start typing`;
    if (got.outlinesFailed)
      note(
        "Couldn't load the country borders, which the line is cut to. Reload to try again.",
        true,
      );
  } catch (e) {
    note(
      "Couldn't load the list of countries: " +
        cleanText(e && e.message, 70) +
        ". Check your connection and reload.",
      true,
    );
  } finally {
    progress(null);
  }
  if (COUNTRIES.length) await presets.start();
}

const presets = setupPresets({
  examples: EXAMPLES,
  lookToControls,
  // Only countries with an outline (the line is cut to it) and enough land
  // for a line worth drawing.
  countries: () =>
    COUNTRIES.filter((c) => {
      const s = shapeFor(c);
      return s && landArea(s.polys) >= MIN_RANDOM_AREA;
    }).map((c) => c.code),
  currentCountry: () => chosen?.code || null,
  pickCountry: (code) => pickCountry(COUNTRIES.find((c) => c.code === code)),
});

syncUI();
start();
