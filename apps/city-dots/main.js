/**
 * City dots — a country's largest towns and cities as bare dots, sized by
 * population, with no borders or names: the pattern of where people live is
 * the clue.
 *
 * Flow: CLDR names fill the picker, world-atlas supplies the outline that
 * frames the map (and decides what "mainland" means), and the GeoNames city
 * list loads in the background → pick a country → choose how many cities and
 * how they look → export. Decoding lives in cities.js, choosing and placing
 * the dots in dots.js, drawing in render.js.
 */

import { addBackLink } from "../../shared/back-link.js";
import { loadNumeric, loadTerritories } from "../../shared/cldr.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, setSeg } from "../../shared/dom.js";
import { MAINLAND_OVERRIDE, isNum } from "../../shared/geo.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { bareName, cleanText, slugify } from "../../shared/text.js";
import { clamp, own } from "../../shared/util.js";
import { WORLD_ATLAS_URL, topoCountries } from "../../shared/world.js";
import { decodeCities, isFormatError } from "./cities.js";
import { ALIASES, CITIES_URL, COUNT_MAX, COUNT_MIN, MAX_BYTES } from "./config.js";
import { dotsFor, drawSheet } from "./render.js";

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Territory */
/** @typedef {import("../../shared/world.js").CountryShape} CountryShape */
/** @typedef {import("./cities.js").City} City */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Territory[]} */
let COUNTRIES = [];
/** @type {Map<string, string>} alpha-2 → ISO numeric */
let NUMERIC = new Map();
/** @type {CountryShape[]} */
let SHAPES = [];
/** @type {Map<string, City[]> | null} by alpha-2; null until loaded */
let CITIES = null;
/** Why the city list is missing, once it has failed. */
let citiesError = "";

/** @type {Territory | null} */
let chosen = null;
/** @type {CountryShape | null} the outline matching `chosen`, if any */
let shape = null;
/** Whether the footnote is still the generated one. */
let footnoteAuto = true;
/** Loading state, for the bar: the countries come first, then the cities. */
let countriesDone = false;
let citiesDone = false;
/** @type {number | undefined} */
let citiesFrac;

const mainOnly = () => isPressed("extMain");

/**
 * The loading bar, with real progress when the size is known.
 *
 * @param {string | null} label
 * @param {number} [frac] 0–1, or omit for an indeterminate bar
 */
function progress(label, frac) {
  const bar = $("bar");
  if (label === null) {
    bar.style.display = "none";
    bar.classList.remove("pending");
    $("loadLabel").textContent = "";
    return;
  }
  bar.style.display = "block";
  bar.classList.toggle("pending", !isNum(frac));
  if (isNum(frac)) bar.firstElementChild.style.width = Math.round(clamp(frac, 0, 1) * 100) + "%";
  $("loadLabel").textContent = label;
}

/** Show whichever download is still running. */
function showLoading() {
  if (!countriesDone) progress("Loading countries");
  else if (!citiesDone) progress("Loading the city list", citiesFrac);
  else progress(null);
}

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    count: clamp(Math.round(+$("count").value) || 40, COUNT_MIN, COUNT_MAX),
    equal: isPressed("sizeEqual"),
    dotScale: clamp(+$("dotSize").value || 100, 30, 200) / 100,
    dot: safeColour($("dotColor").value, "#f0a048"),
    outline: $("optOutline").checked,
    capital: $("optCapital").checked,
    bg: safeColour($("bgColor").value, "#0f1115"),
    bgNone: $("bgNone").checked,
    margin: clamp(+$("margin").value || 0, 0, 30) / 100,
    name: $("optName").checked,
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
    capColour: safeColour($("capColor").value, "#e9ecf2"),
    footnote: cleanText($("noteText").value, 160),
    credit: $("optCredit").checked,
  };
}

/** @returns {import("./render.js").SheetContent} */
function sheetContent() {
  return {
    polys: shape ? shape.polys : null,
    shapeName: shape ? shape.name : "",
    cities: chosen && CITIES ? CITIES.get(chosen.code) || [] : null,
    label: chosen ? chosen.name : "",
    mainOnly: mainOnly(),
  };
}

/**
 * The outline for a country: by ISO numeric code, which is how world-atlas
 * identifies its shapes, or by name for the few it leaves without a code.
 *
 * @param {Territory} t
 * @returns {CountryShape | null}
 */
function shapeFor(t) {
  const num = NUMERIC.get(t.code);
  const byId = num ? SHAPES.find((s) => s.id === num) : null;
  if (byId) return byId;
  const names = new Set([t.name, ...t.alts].map(bareName));
  return SHAPES.find((s) => names.has(bareName(s.name))) || null;
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
    "Cities",
    "https://www.geonames.org/",
    "GeoNames, places of 1000+ people · CC BY 4.0 — via all-the-cities",
  );
  if (shape)
    row(
      "Outline",
      "https://github.com/topojson/world-atlas",
      "Natural Earth admin-0, 1:50m, public domain — via world-atlas",
    );
  row("Country names", "https://cldr.unicode.org/", "Unicode CLDR");

  const caveats = [
    "GeoNames counts the population of each place as it defines it — sometimes the city proper, sometimes the wider municipality — and the figures date from different censuses and estimates, so the order of the smaller towns can be off.",
    "Drawn in Web Mercator, so countries far from the equator look stretched.",
  ];
  if (!shape)
    caveats.push(
      "There is no outline for this country at this scale, so the map is framed on the cities alone and every one of them is shown.",
    );
  else if (mainOnly())
    caveats.push(
      own(MAINLAND_OVERRIDE, shape.name)
        ? "The mainland here is defined by a fixed area, because distance alone gets this country wrong."
        : "Only cities on the largest landmass and the islands within 400 km of it are drawn.",
    );
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !chosen;
}

/** The generated footnote, describing what the dots are. */
function autoFootnote(/** @type {number} */ n) {
  if (!n) return "";
  if (n === 1) return "The only town of 1000 people or more.";
  const what = `The ${n} largest towns and cities`;
  return isPressed("sizeEqual") ? what + "." : `${what}, sized by population.`;
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

/** Redraw the sheet after any change. */
function refresh() {
  syncUI();
  if (!chosen) {
    $("sheetWrap").hidden = true;
    $("empty").hidden = false;
    $("sources").hidden = true;
    return;
  }
  if (!CITIES) {
    if (citiesError) note(citiesError, true);
    else note(`The city list is still loading — ${chosen.name} will appear when it's ready.`);
    return;
  }
  const opts = currentOptions();
  const content = sheetContent();
  const { dots } = dotsFor(content, opts.count, opts.capital);
  if (footnoteAuto) {
    $("noteText").value = autoFootnote(dots.length);
    opts.footnote = $("noteText").value;
  }
  if (!dots.length) {
    $("sheetWrap").hidden = true;
    $("empty").hidden = false;
    renderSources();
    note(`GeoNames lists no towns of 1000 people or more for ${chosen.name}.`);
    return;
  }
  try {
    drawSheet($("sheet"), opts, content);
    $("sheetWrap").hidden = false;
    $("empty").hidden = true;
    $("countHint").textContent =
      dots.length >= opts.count
        ? ""
        : dots.length === 1
          ? "Only one place of 1000+ people here."
          : `Only ${dots.length} places of 1000+ people here.`;
    renderSources();
  } catch (e) {
    note("Couldn't draw the map: " + cleanText(e && e.message, 80), true);
  }
}

/** Enable, disable and label the controls that depend on other controls. */
function syncUI() {
  const ready = !!(chosen && CITIES);
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || $("bgNone").checked;
  $("dlJpg").title = $("bgNone").checked ? "JPEG cannot store transparency — export as PNG" : "";
  $("pngOnly").hidden = !$("bgNone").checked;
  $("bgColor").disabled = $("bgNone").checked;
  $("bgHex").disabled = $("bgNone").checked;
  $("revealTag").hidden = !$("optName").checked;
  $("capTag").hidden = !$("optCapital").checked;
  $("countOut").textContent = $("count").value;
  $("dotSizeOut").textContent = $("dotSize").value + "%";
  $("marginOut").textContent = $("margin").value + "%";
  $("noteReset").hidden = footnoteAuto;
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
  if (type === "image/jpeg") opts.bgNone = false;
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts, sheetContent());
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The filename shouldn't give away what the picture is hiding.
    const slug = opts.name ? slugify(chosen.name) : hashSlug(chosen.code + "|" + opts.count);
    downloadBlob(blob, `city-dots-${slug || "map"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

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
seg("extMain", "extAll");
seg("extAll", "extMain");
seg("sizePop", "sizeEqual");
seg("sizeEqual", "sizePop");
seg("capTop", "capBottom");
seg("capBottom", "capTop");

const refreshSoon = debounce(refresh, 120);
for (const id of ["count", "dotSize", "margin"])
  $(id).addEventListener("input", () => {
    syncUI();
    refreshSoon();
  });
for (const id of ["optOutline", "optCapital", "bgNone", "optName", "optCredit"])
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

bindColour("dotColor", "dotHex", refresh);
bindColour("bgColor", "bgHex", refresh);
bindColour("capColor", "capHex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

/**
 * Download a binary file, refusing anything implausibly large, and report
 * progress when the server says how big it is.
 *
 * @param {string} url
 * @param {number} maxBytes
 * @param {(frac: number | undefined) => void} onProgress
 * @returns {Promise<Uint8Array>}
 */
async function fetchBytes(url, maxBytes, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const declared = parseInt(r.headers.get("content-length") || "", 10);
  if (declared > maxBytes) throw new Error("the file is unexpectedly large");
  if (!r.body) {
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > maxBytes) throw new Error("the file is unexpectedly large");
    return buf;
  }
  const reader = r.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (got > maxBytes) {
      reader.cancel().catch(() => {});
      throw new Error("the file is unexpectedly large");
    }
    chunks.push(value);
    onProgress(declared > 0 ? got / declared : undefined);
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function loadCities() {
  try {
    const bytes = await fetchBytes(CITIES_URL, MAX_BYTES, (frac) => {
      citiesFrac = frac;
      if (countriesDone) showLoading();
    });
    CITIES = decodeCities(bytes);
    if (!CITIES.size) throw new Error("no cities in the file");
  } catch (e) {
    CITIES = null;
    citiesError =
      "Couldn't load the city list: " +
      (isFormatError(e) ? "the file is damaged" : cleanText(e && e.message, 70)) +
      ". Check your connection and reload.";
    note(citiesError, true);
  } finally {
    citiesDone = true;
    showLoading();
  }
  if (chosen) refresh();
  else syncUI();
}

async function loadCountries() {
  showLoading();
  const outlines = fetch(WORLD_ATLAS_URL)
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(topoCountries)
    .catch(() => /** @type {CountryShape[]} */ ([])); // the dots still work without
  try {
    const [territories, numeric, shapes] = await Promise.all([
      loadTerritories(),
      loadNumeric().catch(() => new Map()),
      outlines,
    ]);
    COUNTRIES = territories;
    NUMERIC = numeric;
    SHAPES = shapes;
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — start typing`;
    input.focus();
    if (!SHAPES.length)
      note("Couldn't load the country outlines, so maps are framed on the cities alone.");
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
loadCountries();
loadCities();
