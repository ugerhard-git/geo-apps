/**
 * Climate charts — a city's average year, as monthly temperature and
 * precipitation, with nothing to say where it is: the shape of the seasons
 * is the clue.
 *
 * Flow: CLDR names fill the picker while the GeoNames city list loads in the
 * background → pick a country, and its capital is chosen (or another of its
 * largest towns) → thirty years of daily ERA5 data come from Open-Meteo and
 * are averaged into months (climate.js) → the chart is drawn (render.js) →
 * export.
 */

import { addBackLink } from "../../shared/back-link.js";
import { loadTerritories } from "../../shared/cldr.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, setSeg } from "../../shared/dom.js";
import { isNum } from "../../shared/geo.js";
import { isFormatError, loadCities } from "../../shared/geonames.js";
import { ALIASES } from "../../shared/map-countries.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { cleanText, slugify } from "../../shared/text.js";
import { clamp, own } from "../../shared/util.js";
import { annual, loadNormals } from "./climate.js";
import { CITY_CHOICES, PERIOD } from "./config.js";
import { drawSheet, toF, toIn } from "./render.js";

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Territory */
/** @typedef {import("../../shared/geonames.js").City} City */
/** @typedef {import("./climate.js").Normals} Normals */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Territory[]} */
let COUNTRIES = [];
/** @type {Map<string, City[]> | null} */
let CITIES = null;
let citiesError = "";
/** @type {number | undefined} */
let citiesFrac;
let countriesDone = false;
let fetchingClimate = false;

/** @type {Territory | null} */
let chosen = null;
/** @type {City[]} the towns offered for the chosen country */
let choices = [];
/** @type {City | null} */
let place = null;
/** @type {Normals | null} */
let normals = null;
/** Incremented by every climate request, so a slow answer can't overwrite a newer one. */
let request = 0;
let footnoteAuto = true;

/* ═══════════════════════════════════════════════════════════
   Loading bar
   ═══════════════════════════════════════════════════════════ */

function showLoading() {
  const bar = $("bar");
  /** @type {[string, number | undefined] | null} */
  let what = null;
  if (!countriesDone) what = ["Loading countries", undefined];
  else if (fetchingClimate) what = ["Fetching thirty years of weather", undefined];
  else if (!CITIES && !citiesError) what = ["Loading the list of towns", citiesFrac];
  if (!what) {
    bar.style.display = "none";
    bar.classList.remove("pending");
    $("loadLabel").textContent = "";
    return;
  }
  const [label, frac] = what;
  bar.style.display = "block";
  bar.classList.toggle("pending", !isNum(frac));
  if (isNum(frac)) bar.firstElementChild.style.width = Math.round(clamp(frac, 0, 1) * 100) + "%";
  $("loadLabel").textContent = label;
}

/* ═══════════════════════════════════════════════════════════
   Options
   ═══════════════════════════════════════════════════════════ */

const imperial = () => isPressed("unitsImperial");

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    imperial: imperial(),
    walterLieth: isPressed("scaleWL") && !imperial(),
    band: $("optBand").checked,
    julyFirst: isPressed("startJul"),
    values: $("optValues").checked,
    axes: $("optAxes").checked,
    tempColour: safeColour($("tempColor").value, "#e5603e"),
    rainColour: safeColour($("rainColor").value, "#4a8fd8"),
    ink: safeColour($("inkColor").value, "#e9ecf2"),
    bg: safeColour($("bgColor").value, "#0f1115"),
    bgNone: $("bgNone").checked,
    name: $("optName").checked,
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
    footnote: cleanText($("noteText").value, 160),
    credit: $("optCredit").checked,
  };
}

/** The place, as "name" prints it. */
function placeLabel() {
  if (!place || !chosen) return "";
  return place.name ? `${place.name}, ${chosen.name}` : chosen.name;
}

/** The generated footnote: the year's average temperature and precipitation. */
function autoFootnote() {
  if (!normals) return "";
  const a = annual(normals);
  if (a.mean === null || a.precip === null) return "";
  const t = imperial() ? `${toF(a.mean).toFixed(1)} °F` : `${a.mean.toFixed(1)} °C`;
  const p = imperial()
    ? `${toIn(a.precip).toFixed(1)} in`
    : `${Math.round(a.precip).toLocaleString("en")} mm`;
  return `Average ${t} · ${p} of precipitation a year`.replace("-", "−");
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
    "Climate",
    "https://open-meteo.com/en/docs/historical-weather-api",
    `Open-Meteo historical weather API (ERA5 reanalysis, Copernicus), daily values ${PERIOD.from}–${PERIOD.to} · CC BY 4.0`,
  );
  row(
    "Town",
    "https://www.geonames.org/",
    "GeoNames, places of 1000+ people · CC BY 4.0 — via all-the-cities",
  );
  row("Country names", "https://cldr.unicode.org/", "Unicode CLDR");
  const elev =
    normals && normals.elevation !== null
      ? ` The data's grid point lies at ${Math.round(normals.elevation)} m.`
      : "";
  $("caveat").textContent =
    "These are averages over thirty years from a reanalysis — a weather model fitted to observations — " +
    "for the area around the town, not readings from its weather station. Mountain and coastal towns can " +
    "differ from station records by a degree or two." +
    elev;
  $("sources").hidden = !normals;
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
  $("country").value = c.name;
  picker.close();
  note("");
  fillPlaces();
}

/**
 * Offer the capital first, then the largest towns, and choose the first.
 */
function fillPlaces() {
  const sel = $("city");
  if (!chosen) return;
  if (!CITIES) {
    sel.replaceChildren();
    sel.disabled = true;
    if (citiesError) note(citiesError, true);
    else note(`The list of towns is still loading — ${chosen.name} will appear when it's ready.`);
    return;
  }
  const all = (CITIES.get(chosen.code) || []).filter((c) => c.name);
  const capitals = all.filter((c) => c.capital);
  const rest = all.filter((c) => !c.capital).slice(0, CITY_CHOICES);
  choices = [...capitals, ...rest];
  sel.replaceChildren(
    ...choices.map((c, i) => {
      const pop =
        c.pop >= 1e6
          ? `${(c.pop / 1e6).toFixed(1)} M`
          : c.pop >= 1000
            ? `${Math.round(c.pop / 1000)} k`
            : "";
      const label = `${c.name}${c.capital ? " · capital" : pop ? " · " + pop : ""}`;
      return new Option(label, String(i)); // text, never markup
    }),
  );
  sel.disabled = !choices.length;
  if (!choices.length) {
    place = null;
    normals = null;
    note(`GeoNames lists no towns for ${chosen.name}.`);
    refresh();
    return;
  }
  choosePlace(0);
}

/** @param {number} i index into `choices` */
async function choosePlace(i) {
  place = choices[i] || null;
  normals = null;
  if (!place) return refresh();
  const mine = ++request;
  fetchingClimate = true;
  showLoading();
  refresh();
  try {
    const got = await loadNormals(place.lat, place.lon);
    if (mine !== request) return;
    normals = got;
    if (got.mean.every((v) => v === null)) {
      normals = null;
      note("Open-Meteo returned no usable data for this place.", true);
    } else note("");
  } catch (e) {
    if (mine !== request) return;
    note("Couldn't fetch the climate data: " + cleanText(e && e.message, 120) + ".", true);
  } finally {
    if (mine === request) {
      fetchingClimate = false;
      showLoading();
      refresh();
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

function refresh() {
  if (footnoteAuto) $("noteText").value = autoFootnote();
  syncUI();
  if (!normals) {
    $("sheetWrap").hidden = true;
    $("empty").hidden = false;
    $("sources").hidden = true;
    return;
  }
  try {
    drawSheet($("sheet"), currentOptions(), { normals, label: placeLabel() });
    $("sheetWrap").hidden = false;
    $("empty").hidden = true;
    renderSources();
  } catch (e) {
    note("Couldn't draw the chart: " + cleanText(e && e.message, 80), true);
  }
}

function syncUI() {
  const ready = !!normals;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || $("bgNone").checked;
  $("dlJpg").title = $("bgNone").checked ? "JPEG cannot store transparency — export as PNG" : "";
  $("pngOnly").hidden = !$("bgNone").checked;
  $("bgColor").disabled = $("bgNone").checked;
  $("bgHex").disabled = $("bgNone").checked;
  $("revealTag").hidden = !$("optName").checked;
  $("noteReset").hidden = footnoteAuto;
  // The Walter–Lieth scale is defined in °C and mm.
  $("scaleWL").disabled = imperial();
  $("scaleHint").hidden = !imperial();
}

/**
 * @param {string} type
 * @param {string} ext
 */
async function exportSheet(type, ext) {
  if (!normals || !place || !chosen) return;
  const opts = currentOptions();
  if (type === "image/jpeg") opts.bgNone = false;
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts, { normals, label: placeLabel() });
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The filename shouldn't give away what the picture is hiding.
    const slug = opts.name
      ? slugify(placeLabel())
      : hashSlug(`${chosen.code}|${place.lat}|${place.lon}`);
    downloadBlob(blob, `climate-${slug || "chart"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

$("city").addEventListener("change", () => {
  const i = parseInt($("city").value, 10);
  if (Number.isInteger(i)) choosePlace(i);
});

/**
 * @param {string} on
 * @param {string} off
 */
function seg(on, off) {
  $(on).addEventListener("click", () => {
    if (/** @type {HTMLButtonElement} */ ($(on)).disabled) return;
    setSeg($(on), $(off));
    refresh();
  });
}
seg("unitsMetric", "unitsImperial");
seg("unitsImperial", "unitsMetric");
seg("scaleWL", "scaleFit");
seg("scaleFit", "scaleWL");
seg("startJan", "startJul");
seg("startJul", "startJan");
seg("capTop", "capBottom");
seg("capBottom", "capTop");
for (const id of ["optBand", "optValues", "optAxes", "bgNone", "optName", "optCredit"])
  $(id).addEventListener("change", refresh);

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
const refreshLater = debounce(refresh, 400);
for (const id of ["customW", "customH"]) $(id).addEventListener("input", refreshLater);

const refreshAfterTyping = debounce(refresh, 300);
$("capText").addEventListener("input", () => {
  $("capPosField").hidden = !cleanText($("capText").value, 120);
  refreshAfterTyping();
});
$("noteText").addEventListener("input", () => {
  footnoteAuto = false;
  syncUI();
  refreshAfterTyping();
});
$("noteReset").addEventListener("click", () => {
  footnoteAuto = true;
  refresh();
});

bindColour("tempColor", "tempHex", refresh);
bindColour("rainColor", "rainHex", refresh);
bindColour("inkColor", "inkHex", refresh);
bindColour("bgColor", "bgHex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

async function start() {
  showLoading();
  loadCities(
    (frac) => {
      citiesFrac = frac;
      showLoading();
    },
    { names: true },
  )
    .then((cities) => {
      CITIES = cities;
    })
    .catch((e) => {
      citiesError =
        "Couldn't load the list of towns: " +
        (isFormatError(e) ? "the file is damaged" : cleanText(e && e.message, 70)) +
        ". Check your connection and reload.";
      note(citiesError, true);
    })
    .finally(() => {
      showLoading();
      if (chosen && !place) fillPlaces();
    });
  try {
    COUNTRIES = await loadTerritories();
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — start typing`;
    input.focus();
  } catch (e) {
    note(
      "Couldn't load the list of countries: " +
        cleanText(e && e.message, 70) +
        ". Check your connection and reload.",
      true,
    );
  } finally {
    countriesDone = true;
    showLoading();
  }
}

syncUI();
start();
