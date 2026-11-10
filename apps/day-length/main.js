/**
 * Day length — sunrise, sunset and twilight in a country's capital through
 * the year, in its local clock time: how long the days get, how late the sun
 * rises and when the clocks change are the clue.
 *
 * Flow: CLDR names and the capitals file (data/capitals.json: position and
 * time zone, from GeoNames) load together → only countries with a capital in
 * the file are offered → pick a country → a year of days is worked out
 * (sun.js), using the browser's own time-zone rules for summer time → the
 * sheet is drawn (render.js) → export.
 *
 * Nothing is fetched after start-up, and the year is worked out once per
 * country: changing the view or the colours only redraws.
 *
 *   config.js    the data file and the credit line
 *   capitals.js  reading and checking the capitals file (pure)
 *   sun.js       the sun's times and the clock's offsets (pure)
 *   render.js    drawing the sheet
 *   presets.js   examples to start from, and how a look colours the sheet
 *   welcome.js   the text of the welcome window
 */

import { addBackLink } from "../../shared/back-link.js";
import { loadTerritories } from "../../shared/cldr.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, progress, setSeg } from "../../shared/dom.js";
import { getLargeJson } from "../../shared/net.js";
import { setupPresets } from "../../shared/presets.js";
import { canvasToBlob, downloadBlob, frameSpec, hashSlug } from "../../shared/sheet.js";
import { cleanText, slugify } from "../../shared/text.js";
import { setupWelcome } from "../../shared/welcome.js";
import { parseCapitalsFile } from "./capitals.js";
import { CREDIT, DATA_URL, MAX_DATA_BYTES } from "./config.js";
import { EXAMPLES, lookToControls } from "./presets.js";
import { drawSheet } from "./render.js";
import { clockText, extremes, yearOfDays } from "./sun.js";
import { WELCOME } from "./welcome.js";

// What the app does and how it works: opens by itself on the first visit.
setupWelcome("day-length", WELCOME);

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Territory */
/** @typedef {import("./capitals.js").Capital} Capital */
/** @typedef {import("./sun.js").Day} Day */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** Countries with a capital in the file, by name. @type {Territory[]} */
let COUNTRIES = [];
/** @type {Map<string, Capital>} */
let CAPITALS = new Map();
/** The year drawn: this one, so summer time follows this year's rules. */
const YEAR = new Date().getFullYear();

/** @type {Territory | null} */
let chosen = null;
/** The chosen capital's year of days. @type {Day[]} */
let days = [];

/** The two default captions: one follows the view while the user hasn't typed their own. */
const CAPTIONS = { clock: "Daylight through the year", hours: "Hours of daylight" };

/** @returns {"clock" | "hours"} */
const view = () => (isPressed("viewHours") ? "hours" : "clock");

/* ═══════════════════════════════════════════════════════════
   Drawing
   ═══════════════════════════════════════════════════════════ */

/** @returns {import("./render.js").SheetOptions} */
function sheetOptions() {
  const { W, H } = frameSpec();
  const v = view();
  const { longest, shortest } = extremes(days);
  const subtitle = [
    $("optName").checked && chosen ? chosen.name : "",
    v === "clock" ? "In the capital, in local clock time" : "In the capital, day by day",
    $("optExtremes").checked
      ? `longest day ${clockText(longest)} h, shortest ${clockText(shortest)} h`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const footnote =
    v === "clock"
      ? `Sunrise and sunset in ${YEAR}, worked out from the capital's position, with its time zone and any summer time`
      : `Hours of daylight in ${YEAR}, worked out from the capital's position`;
  return {
    W,
    H,
    view: v,
    bg: safeColour($("bgColor").value, "#f6f2ea"),
    transparent: $("optTransparent").checked,
    ink: safeColour($("capColor").value, "#23262d"),
    day: safeColour($("dayColor").value, "#e8be7e"),
    twilight: safeColour($("twilightColor").value, "#658aab"),
    night: safeColour($("nightColor").value, "#1d344e"),
    line: safeColour($("lineColor").value, "#b4553a"),
    showTwilight: $("optTwilight").checked,
    showLines: $("optLines").checked,
    legend: $("optLegend").checked,
    caption: cleanText($("capText").value, 120),
    subtitle,
    footnote: $("optFootnote").checked ? footnote : "",
    credit: $("optCredit").checked ? CREDIT : "",
  };
}

/**
 * Draw the chosen capital's year on `canvas`.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {boolean} [opaque] always fill the background (JPEG has no transparency)
 */
async function paint(canvas, opaque = false) {
  const o = sheetOptions();
  if (opaque) o.transparent = false;
  // The canvas draws with whatever font is ready; wait for the sheet's own.
  await document.fonts.load(`500 40px "Space Grotesk"`).catch(() => {});
  drawSheet(canvas, o, days);
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
  const capital = chosen ? CAPITALS.get(chosen.code) : null;
  row(
    "Capital and time zone",
    "https://www.geonames.org/",
    capital ? `GeoNames, CC BY 4.0 — ${capital.name}, ${capital.tz}` : "GeoNames, CC BY 4.0",
  );
  row(
    "Sunrise and sunset",
    "https://gml.noaa.gov/grad/solcalc/solareqns.PDF",
    "NOAA's solar position equations",
  );
  row(
    "Summer time",
    "https://www.iana.org/time-zones",
    "The IANA time zone rules, as your browser knows them",
  );
  row("Country names", "https://cldr.unicode.org/", "Unicode CLDR");
  $("caveat").textContent = [
    "The times are worked out, not looked up: they are accurate to about a minute, for the capital's centre and a flat horizon.",
    "Twilight is civil twilight: the sun up to 6° below the horizon, when it is still light enough to see outdoors.",
    `Summer time follows this year's rules (${YEAR}); a country that changes its clocks later is drawn as it is now.`,
  ].join(" ");
  $("sources").hidden = !chosen;
}

/* ═══════════════════════════════════════════════════════════
   Picking
   ═══════════════════════════════════════════════════════════ */

const picker = createCountryPicker({
  items: () => COUNTRIES,
  forms: (c) => [c.name, ...c.alts],
  code: (c) => c.code,
  label: (c) => c.name,
  onPick: pickCountry,
});

/** @param {Territory | undefined} c */
function pickCountry(c) {
  const capital = c && CAPITALS.get(c.code);
  if (!c || !capital) return;
  chosen = c;
  days = yearOfDays(capital, YEAR);
  $("country").value = c.name;
  picker.close();
  note("");
  return refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

let request = 0;

/** Redraw the sheet. */
async function refresh() {
  syncUI();
  const mine = ++request;
  if (!chosen || !days.length) {
    $("sheetWrap").hidden = true;
    $("empty").hidden = false;
    $("sources").hidden = true;
    return;
  }
  await paint($("sheet"));
  if (mine !== request) return;
  $("sheetWrap").hidden = false;
  $("empty").hidden = true;
  renderSources();
}

/** Enable, disable and label the controls that depend on other controls. */
function syncUI() {
  const ready = !!chosen;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("revealTag").hidden = !$("optName").checked;
  $("clockOptions").hidden = view() !== "clock";
  $("viewHint").textContent =
    view() === "clock"
      ? "Day, twilight and night through the year, with the clock time running up the side."
      : "How many hours the sun is up, day by day.";
}

/**
 * Draw the sheet at full size and download it.
 *
 * @param {string} type MIME type
 * @param {string} ext file extension
 */
async function exportSheet(type, ext) {
  if (!chosen) return;
  try {
    const canvas = document.createElement("canvas");
    await paint(canvas, type === "image/jpeg");
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The filename shouldn't give away what the picture is hiding.
    const slug = $("optName").checked
      ? slugify(chosen.name)
      : hashSlug(`${chosen.code}|${view()}|${YEAR}|day-length`);
    downloadBlob(blob, `day-length-${slug || "sheet"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

/**
 * Switch the view; the caption follows while it's still one of the defaults.
 *
 * @param {string} on
 * @param {string} off
 */
function switchView(on, off) {
  setSeg($(on), $(off));
  const cap = $("capText");
  if (Object.values(CAPTIONS).includes(cap.value)) cap.value = CAPTIONS[view()];
  refresh();
}
$("viewClock").addEventListener("click", () => switchView("viewClock", "viewHours"));
$("viewHours").addEventListener("click", () => switchView("viewHours", "viewClock"));

const redraw = debounce(() => refresh(), 60);
for (const id of [
  "optTwilight",
  "optLines",
  "optLegend",
  "optExtremes",
  "optFootnote",
  "optName",
  "optCredit",
  "optTransparent",
])
  $(id).addEventListener("change", redraw);

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  redraw();
});
const redrawLater = debounce(() => refresh(), 400);
for (const id of ["customW", "customH", "capText"]) $(id).addEventListener("input", redrawLater);

for (const id of ["bg", "cap", "day", "twilight", "night", "line"])
  bindColour(`${id}Color`, `${id}Hex`, redraw);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

async function start() {
  progress("Loading countries", true);
  try {
    const [territories, file] = await Promise.all([
      loadTerritories(),
      getLargeJson(DATA_URL, MAX_DATA_BYTES),
    ]);
    CAPITALS = parseCapitalsFile(file);
    COUNTRIES = territories.filter((t) => CAPITALS.has(t.code));
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — start typing`;
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
  countries: () => COUNTRIES.map((c) => c.code),
  currentCountry: () => chosen?.code || null,
  pickCountry: (code) => pickCountry(COUNTRIES.find((c) => c.code === code)),
});

syncUI();
start();
