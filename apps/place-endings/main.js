/**
 * Place-name endings — how a country's town names typically end (-torp,
 * -tepec, -pur), as a cloud of endings or a dozen real towns: the sound of
 * the names is the clue.
 *
 * Flow: CLDR names and the GeoNames place list load together → the world's
 * endings are counted once, and only countries with enough place names are
 * offered → pick a country → its typical endings are worked out
 * (endings.js) and, for "Twelve towns", a sample of real towns is drawn →
 * the sheet is drawn (render.js) → export.
 *
 * Nothing is fetched after start-up: changing the country or any option
 * only recounts and redraws.
 *
 *   config.js   thresholds and the credit line
 *   endings.js  the words, their endings, and which are typical (pure)
 *   render.js   drawing the sheet
 *   presets.js  examples to start from, and how a look colours the sheet
 *   welcome.js  the text of the welcome window
 */

import { addBackLink } from "../../shared/back-link.js";
import { loadTerritories } from "../../shared/cldr.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import {
  $,
  bindColour,
  debounce,
  isPressed,
  loadFontFamilies,
  note,
  progress,
  setSeg,
} from "../../shared/dom.js";
import { isFormatError, loadCities } from "../../shared/geonames.js";
import { setupPresets } from "../../shared/presets.js";
import { canvasToBlob, downloadBlob, frameSpec, hashSlug } from "../../shared/sheet.js";
import { cleanText, slugify } from "../../shared/text.js";
import { rng } from "../../shared/util.js";
import { setupWelcome } from "../../shared/welcome.js";
import {
  CREDIT,
  MIN_ENDINGS,
  MIN_PLACES,
  SKIP_LARGEST,
  TOWN_COUNT,
  TOWN_MIN_POP,
} from "./config.js";
import { distinctWords, pickTowns, splitEnding, typicalEndings, worldBaseline } from "./endings.js";
import { EXAMPLES, lookToControls } from "./presets.js";
import { drawSheet } from "./render.js";
import { WELCOME } from "./welcome.js";

// What the app does and how it works: opens by itself on the first visit.
setupWelcome("place-endings", WELCOME);

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Territory */
/** @typedef {import("../../shared/geonames.js").City} City */
/** @typedef {import("./endings.js").Ending} Ending */
/** @typedef {import("./endings.js").Baseline} Baseline */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** Countries with enough place names, by name. @type {Territory[]} */
let COUNTRIES = [];
/** The place list, by country code. @type {Map<string, City[]>} */
let CITIES = new Map();
/** Each country's distinct main words. @type {Map<string, string[]>} */
const WORDS = new Map();
/** @type {Baseline | null} */
let world = null;

/** @type {Territory | null} */
let chosen = null;
/** The chosen country's endings, up to 16, most telling first. @type {Ending[]} */
let endings = [];
/** Which sample of towns: changed by "Other towns". */
let shuffles = 0;

/** The two default captions: one follows the view while the user hasn't typed their own. */
const CAPTIONS = {
  cloud: "How towns in this country end",
  towns: "Twelve towns in this country",
};

/** @returns {"cloud" | "towns"} */
const view = () => (isPressed("viewTowns") ? "towns" : "cloud");

/* ═══════════════════════════════════════════════════════════
   What to draw
   ═══════════════════════════════════════════════════════════ */

/**
 * A number from a country code, so each country starts with its own sample
 * of towns and the same one every time.
 *
 * @param {string} code
 */
const seedOf = (code) => [...code].reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7);

/**
 * The towns for the "Twelve towns" view, each split before its ending.
 *
 * @returns {Array<[string, string]>}
 */
function currentTowns() {
  if (!chosen) return [];
  const cities = CITIES.get(chosen.code) || [];
  const skipLargest = $("optSkipLargest").checked ? SKIP_LARGEST : 0;
  const random = rng(seedOf(chosen.code) + shuffles * 7919);
  let names = pickTowns(cities, TOWN_COUNT, { minPop: TOWN_MIN_POP, skipLargest, random });
  // A country with few towns of that size: fill up from the smaller places.
  if (names.length < TOWN_COUNT)
    names = pickTowns(cities, TOWN_COUNT, { minPop: 0, skipLargest, random });
  return names.map((n) => splitEnding(n, endings));
}

/** @returns {Ending[]} the endings the cloud shows */
const shownEndings = () => endings.slice(0, Number($("count").value) || 12);

/** @returns {import("./render.js").SheetOptions} */
function sheetOptions() {
  const { W, H } = frameSpec();
  const v = view();
  const places = chosen ? (WORDS.get(chosen.code) || []).length : 0;
  const explain =
    v === "cloud"
      ? "The most typical endings of place names, bigger for more common"
      : $("optColourEndings").checked
        ? "Typical endings in colour"
        : "";
  const from =
    v === "cloud"
      ? `From the ${places.toLocaleString("en-GB")} places with at least 1,000 inhabitants`
      : $("optSkipLargest").checked
        ? `Picked at random from places with at least ${TOWN_MIN_POP.toLocaleString("en-GB")} inhabitants, leaving out the largest cities`
        : `Picked at random from places with at least ${TOWN_MIN_POP.toLocaleString("en-GB")} inhabitants`;
  return {
    W,
    H,
    bg: safeColour($("bgColor").value, "#f6f2ea"),
    transparent: $("optTransparent").checked,
    ink: safeColour($("capColor").value, "#23262d"),
    accent: safeColour($("accentColor").value, "#b4553a"),
    second: safeColour($("secondColor").value, "#2f6f8f"),
    caption: cleanText($("capText").value, 120),
    subtitle: [
      $("optName").checked && chosen ? chosen.name : "",
      $("optExplain").checked ? explain : "",
    ]
      .filter(Boolean)
      .join(" · "),
    footnote: $("optFootnote").checked ? from : "",
    credit: $("optCredit").checked ? CREDIT : "",
  };
}

/**
 * Draw the chosen country on `canvas`.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {boolean} [opaque] always fill the background (JPEG has no transparency)
 */
async function paint(canvas, opaque = false) {
  const o = sheetOptions();
  if (opaque) o.transparent = false;
  const content = {
    view: view(),
    endings: shownEndings(),
    towns: view() === "towns" ? currentTowns() : [],
    colourEndings: $("optColourEndings").checked,
  };
  // Every file of the sheet's fonts, so accented letters draw correctly.
  await loadFontFamilies(["Literata", "Space Grotesk"]);
  drawSheet(canvas, o, /** @type {import("./render.js").Content} */ (content));
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
    "Place names",
    "https://www.geonames.org/",
    "GeoNames, places with at least 1,000 inhabitants, CC BY 4.0 — via all-the-cities",
  );
  row("Country names", "https://cldr.unicode.org/", "Unicode CLDR");
  $("caveat").textContent = [
    "The endings are worked out here from GeoNames' names: an ending counts as typical when the country uses it at least four times as often as the world does, and the more common it is here, the bigger it is drawn.",
    'Each place\'s longest word is used, so "Nowy Dwór Mazowiecki" counts as "mazowiecki".',
    "Names are as GeoNames writes them, mostly in Latin letters; countries that write in other scripts are romanised, and the spelling can vary.",
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
  if (!c || !world) return;
  chosen = c;
  shuffles = 0;
  endings = typicalEndings(WORDS.get(c.code) || [], world, 16);
  $("country").value = c.name;
  picker.close();
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
  if (!chosen) {
    $("sheetWrap").hidden = true;
    $("empty").hidden = false;
    $("sources").hidden = true;
    return;
  }
  await paint($("sheet"));
  if (mine !== request) return;
  $("sheetWrap").hidden = false;
  $("empty").hidden = true;
  note(
    view() === "cloud" && endings.length < MIN_ENDINGS
      ? `${chosen.name}'s place names share only a few typical endings, so this sheet is a hard one.`
      : "",
  );
  renderSources();
}

/** Enable, disable and label the controls that depend on other controls. */
function syncUI() {
  const ready = !!chosen;
  $("dlPng").disabled = !ready;
  const transparent = $("optTransparent").checked;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("cloudOptions").hidden = view() !== "cloud";
  $("townOptions").hidden = view() !== "towns";
  $("revealTag").hidden = !$("optName").checked;
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
      : hashSlug(`${chosen.code}|${view()}|${shuffles}|endings`);
    downloadBlob(blob, `place-names-${slug || "sheet"}.${ext}`);
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
$("viewCloud").addEventListener("click", () => switchView("viewCloud", "viewTowns"));
$("viewTowns").addEventListener("click", () => switchView("viewTowns", "viewCloud"));

$("shuffle").addEventListener("click", () => {
  shuffles++;
  refresh();
});

const redraw = debounce(() => refresh(), 60);
for (const id of [
  "count",
  "optSkipLargest",
  "optColourEndings",
  "optExplain",
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

bindColour("bgColor", "bgHex", redraw);
bindColour("capColor", "capHex", redraw);
bindColour("accentColor", "accentHex", redraw);
bindColour("secondColor", "secondHex", redraw);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

async function start() {
  progress("Loading countries and place names", true);
  try {
    const [territories, cities] = await Promise.all([
      loadTerritories(),
      loadCities(
        (frac) =>
          progress(
            frac === undefined
              ? "Loading place names"
              : `Loading place names · ${Math.round(frac * 100)}%`,
            true,
          ),
        { names: true },
      ),
    ]);
    CITIES = cities;
    for (const [code, list] of cities) WORDS.set(code, distinctWords(list));
    world = worldBaseline(WORDS.values());
    COUNTRIES = territories.filter((t) => (WORDS.get(t.code) || []).length >= MIN_PLACES);
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — start typing`;
  } catch (e) {
    note(
      "Couldn't load the place names: " +
        (isFormatError(e) ? "the file is damaged" : cleanText(e && e.message, 70)) +
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
