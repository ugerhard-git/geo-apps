/**
 * Shaded relief — a country's terrain as a shaded relief, with no borders,
 * rivers, towns or names: the shape of its mountains and plains is the clue.
 *
 * Flow: CLDR names fill the picker and world-atlas supplies the outlines →
 * pick a country → the sheet is planned (render.js), which decides the area
 * of the map and with it the elevation tiles needed → the tiles load from
 * AWS (tiles.js) → heights are read, shaded (terrain.js) and kept, so that
 * changing colours only repaints → export.
 *
 * The country can be shown three ways: on its background with its outline,
 * blended (the background takes the colour of the country's lowest edge, so
 * the outline fades wherever the border runs through flat ground), or with
 * the terrain of its neighbours around it.
 *
 *   config.js   the tile server, limits, the light and the height colours
 *   terrain.js  tile maths, shading and colouring (pure)
 *   tiles.js    fetching and decoding tiles, with a small cache
 *   render.js   laying out and drawing the sheet
 */

import { addBackLink } from "../../shared/back-link.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import {
  $,
  bindColour,
  bindScale,
  debounce,
  isPressed,
  note,
  progress,
  scaleOf,
  setSeg,
} from "../../shared/dom.js";
import { MAINLAND_OVERRIDE } from "../../shared/geo.js";
import { ALIASES, loadMapCountries } from "../../shared/map-countries.js";
import { projectCountry } from "../../shared/projection.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { cleanText, slugify } from "../../shared/text.js";
import { clamp, own } from "../../shared/util.js";
import { ATTRIBUTION_URL, CREDIT, MAX_TILES, MAX_ZOOM } from "./config.js";
import { drawSheet, neededBox, planSheet, prepareRelief } from "./render.js";
import { chooseZoom, tileKeys } from "./terrain.js";
import { cachedTile, ensureTiles } from "./tiles.js";

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Territory */
/** @typedef {import("../../shared/world.js").CountryShape} CountryShape */
/** @typedef {import("../../shared/world.js").Polys} Polys */
/** @typedef {import("../../shared/projection.js").Box} Box */
/** @typedef {import("./render.js").Mode} Mode */
/** @typedef {import("./render.js").Plan} Plan */
/** @typedef {import("./render.js").Relief} Relief */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Territory[]} */
let COUNTRIES = [];
/** @type {(t: Territory) => CountryShape | null} */
let shapeFor = () => null;

/** @type {Territory | null} */
let chosen = null;
/** @type {CountryShape | null} */
let shape = null;

/** The relief last prepared, and what it was prepared for. */
let reliefKey = "";
/** @type {Relief | null} */
let relief = null;
/** How many tiles were missing from it. */
let missing = 0;
/** Incremented per redraw, so a slow one can't overwrite a newer one. */
let request = 0;

const mainOnly = () => isPressed("extMain");

/** @returns {Mode} */
function mode() {
  if (isPressed("modeOutline")) return "outline";
  return isPressed("modeNeighbours") ? "neighbours" : "blend";
}

/* ═══════════════════════════════════════════════════════════
   What to draw
   ═══════════════════════════════════════════════════════════ */

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    mode: mode(),
    land: safeColour($("landColor").value, "#c4c4c4"),
    shadow: safeColour($("shadowColor").value, "#1e2228"),
    light: safeColour($("lightColor").value, "#ffffff"),
    bg: safeColour($("bgColor").value, "#f8f6f2"),
    byHeight: $("optHeight").checked,
    relief: scaleOf("relief"),
    margin: clamp(+$("margin").value || 0, 0, 30) / 100,
    name: $("optName").checked,
    label: chosen ? chosen.name : "",
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
    capColour: safeColour($("capColor").value, "#1e2228"),
    credit: $("optCredit").checked ? CREDIT : "",
  };
}

/** The country in the plane, and the box it fills. */
let projectedKey = "";
/** @type {{shape: Polys, frame: Box} | null} */
let projected = null;

function projectedCountry() {
  if (!chosen || !shape) return null;
  const key = chosen.code + "|" + mainOnly();
  if (key !== projectedKey) {
    const { shape: plane, boxes } = projectCountry(shape.polys, mainOnly(), shape.name);
    projected = boxes.length
      ? {
          shape: plane,
          frame: {
            x0: Math.min(...boxes.map((b) => b.x0)),
            y0: Math.min(...boxes.map((b) => b.y0)),
            x1: Math.max(...boxes.map((b) => b.x1)),
            y1: Math.max(...boxes.map((b) => b.y1)),
          },
        }
      : null;
    projectedKey = key;
  }
  return projected;
}

/**
 * Plan the sheet on `canvas`, load what it needs and draw it.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} mine the request this belongs to
 * @returns {Promise<boolean>} false if it was overtaken or couldn't draw
 */
async function build(canvas, mine) {
  const country = projectedCountry();
  if (!country) return false;
  const opts = currentOptions();
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  const plan = planSheet(ctx, opts, country.frame);
  const box = neededBox(plan, country.frame, opts.mode);
  const z = chooseZoom(plan.scale, box, MAX_ZOOM, MAX_TILES);
  const key = JSON.stringify([
    projectedKey,
    plan.W,
    plan.H,
    plan.area,
    plan.scale,
    z,
    opts.relief,
    opts.mode === "neighbours",
  ]);
  if (key !== reliefKey || !relief) {
    const keys = tileKeys(box, z);
    const failed = await ensureTiles(
      keys,
      (done, total) => {
        if (mine === request) progress(`Loading the terrain · ${done} of ${total} tiles`, true);
      },
      () => mine !== request,
    );
    if (mine !== request) return false;
    progress("Shading the terrain", true);
    // Let the label paint before the slow part.
    await new Promise((r) => setTimeout(r, 0));
    if (mine !== request) return false;
    relief = prepareRelief(plan, country.shape, z, cachedTile, opts.relief);
    reliefKey = key;
    missing = failed;
  }
  drawSheet(canvas, opts, plan, relief);
  return true;
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
    ATTRIBUTION_URL,
    "SRTM, GMTED2010, ETOPO1, EU-DEM and others — credits and licences",
  );
  row(
    "Border",
    "https://github.com/topojson/world-atlas",
    "Natural Earth admin-0, 1:50m, public domain — via world-atlas",
  );
  row("Country names", "https://cldr.unicode.org/", "Unicode CLDR");

  const caveats = [
    "Heights are exaggerated so that the relief reads at this size: more for flat countries, less for mountainous ones. The slider changes it further.",
    "The border is Natural Earth's at 1:50m, so along a coast the terrain and the outline can differ slightly.",
    "Drawn in Web Mercator, so countries far from the equator look stretched.",
  ];
  if (mainOnly() && shape)
    caveats.push(
      own(MAINLAND_OVERRIDE, shape.name)
        ? "The mainland here is defined by a fixed area, because distance alone gets this country wrong."
        : "Only the largest landmass and the islands within 400 km of it are drawn.",
    );
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !chosen;
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

/** @param {Territory} c */
function pickCountry(c) {
  if (!c) return;
  chosen = c;
  shape = shapeFor(c);
  $("country").value = c.name;
  picker.close();
  note("");
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

function hideSheet() {
  $("sheetWrap").hidden = true;
  $("empty").hidden = false;
}

/** Redraw the sheet after any change. */
async function refresh() {
  syncUI();
  const mine = ++request;
  if (!chosen) {
    hideSheet();
    $("sources").hidden = true;
    return;
  }
  if (!shape || !projectedCountry()) {
    hideSheet();
    note(`There is no outline for ${chosen.name} at this scale, so its terrain can't be cut out.`);
    return;
  }
  try {
    const drawn = await build($("sheet"), mine);
    if (!drawn) return;
    progress(null);
    $("sheetWrap").hidden = false;
    $("empty").hidden = true;
    note(
      missing
        ? `${missing} of the terrain tiles couldn't be loaded, so parts of the map are flat. Reload to try again.`
        : "",
      missing > 0,
    );
    renderSources();
    syncUI();
  } catch (e) {
    if (mine === request) progress(null);
    note("Couldn't draw the terrain: " + cleanText(e && e.message, 80), true);
  }
}

/** Enable, disable and label the controls that depend on other controls. */
function syncUI() {
  const ready = !!(chosen && shape && relief);
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready;
  const m = mode();
  $("bgField").hidden = m !== "outline";
  $("landField").hidden = $("optHeight").checked;
  $("modeHint").textContent =
    m === "outline"
      ? "The country on its own, on the background colour. Its outline is part of the clue."
      : m === "blend"
        ? "The background takes the colour of the country's lowest edge, so the outline fades wherever the border crosses flat ground or the coast."
        : "The terrain around the country too, so there is no edge at all; the country fills the middle.";
  $("revealTag").hidden = !$("optName").checked;
  $("marginOut").textContent = $("margin").value + "%";
}

/**
 * Render the sheet at full size and download it.
 *
 * @param {string} type MIME type
 * @param {string} ext file extension
 */
async function exportSheet(type, ext) {
  if (!chosen) return;
  const opts = currentOptions();
  try {
    const canvas = document.createElement("canvas");
    if (!(await build(canvas, request))) return;
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The filename shouldn't give away what the picture is hiding.
    const slug = opts.name ? slugify(chosen.name) : hashSlug(chosen.code + "|relief");
    downloadBlob(blob, `relief-${slug || "map"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

/**
 * Buttons of which exactly one is pressed.
 *
 * @param {string[]} ids
 */
function group(ids) {
  for (const id of ids)
    $(id).addEventListener("click", () => {
      for (const other of ids) $(other).setAttribute("aria-pressed", String(other === id));
      refresh();
    });
}
group(["modeOutline", "modeBlend", "modeNeighbours"]);
group(["extMain", "extAll"]);

/**
 * @param {string} on
 * @param {string} off
 */
function seg(on, off) {
  $(on).addEventListener("click", () => {
    setSeg($(on), $(off));
    refresh();
  });
}
seg("capTop", "capBottom");
seg("capBottom", "capTop");

const refreshSoon = debounce(refresh, 250);
bindScale("relief", refreshSoon);
$("margin").addEventListener("input", () => {
  syncUI();
  refreshSoon();
});
for (const id of ["optHeight", "optName", "optCredit"]) $(id).addEventListener("change", refresh);

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
const refreshLater = debounce(refresh, 400);
for (const id of ["customW", "customH"]) $(id).addEventListener("input", refreshLater);

$("capText").addEventListener("input", () => {
  $("capPosField").hidden = !cleanText($("capText").value, 120);
  refreshLater();
});

const repaint = debounce(refresh, 60);
bindColour("landColor", "landHex", repaint);
bindColour("shadowColor", "shadowHex", repaint);
bindColour("lightColor", "lightHex", repaint);
bindColour("bgColor", "bgHex", repaint);
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
    input.focus();
    if (got.outlinesFailed)
      note(
        "Couldn't load the country borders, which the terrain is cut to. Reload to try again.",
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
}

syncUI();
start();
