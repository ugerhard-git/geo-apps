/**
 * Outlines — a country's (or one of its regions') shape, turned and mirrored
 * if you like, as a "which country is this?" sheet.
 *
 * Flow: pick a country (Natural Earth outlines) → optionally switch to region
 * mode, which fetches its first-level divisions from geoBoundaries → rotate,
 * flip, style → export. Loading lives in shapes.js, geometry in
 * projection.js and drawing in render.js.
 */

import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, setSeg } from "../../shared/dom.js";
import { MAINLAND_OVERRIDE, isNum } from "../../shared/geo.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { cleanText, norm, slugify } from "../../shared/text.js";
import { clamp, own } from "../../shared/util.js";
import { ALIASES, TOPO_URL } from "./config.js";
import { drawSheet } from "./render.js";
import { iso3For, loadRegionsFor, topoCountries } from "./shapes.js";

/** @typedef {import("./shapes.js").CountryShape} CountryShape */
/** @typedef {import("./shapes.js").Region} Region */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {CountryShape[]} */
let COUNTRIES = [];
/** @type {CountryShape | null} */
let chosen = null;
/** @type {Region | null} */
let chosenRegion = null;
/** @type {Region[] | null} regions of the country currently chosen */
let regions = null;
/** The alpha-3 code the regions were fetched under. */
let regionIso = "";
/** Incremented by every redraw. */
let busy = 0;

const isRegionMode = () => isPressed("modeRegion");
const mainOnly = () => isPressed("extMain");

/**
 * This app's loading bar can show real progress as well as "busy".
 *
 * @param {string | null} label
 * @param {number} [frac] 0–1, or omit for an indeterminate bar
 * @param {boolean} [pending]
 */
function progress(label, frac, pending) {
  const bar = $("bar");
  if (label === null) {
    bar.style.display = "none";
    bar.classList.remove("pending");
    $("loadLabel").textContent = "";
    return;
  }
  bar.style.display = "block";
  bar.classList.toggle("pending", !!pending || !isNum(frac));
  if (isNum(frac)) bar.firstElementChild.style.width = Math.round(clamp(frac, 0, 1) * 100) + "%";
  $("loadLabel").textContent = label;
}

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    line: safeColour($("lineColor").value, "#f0a048"),
    lineWidth: clamp(+$("lineWidth").value || 0, 0, 24),
    fill: safeColour($("fillColor").value, "#2b303b"),
    hole: $("fillNone").checked,
    bg: safeColour($("bgColor").value, "#0f1115"),
    bgNone: $("bgNone").checked,
    rotate: clamp(+$("rotate").value || 0, 0, 359),
    flipH: isPressed("flipH"),
    flipV: isPressed("flipV"),
    margin: clamp(+$("margin").value || 0, 0, 30) / 100,
    name: $("optName").checked,
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
    capColour: safeColour($("capColor").value, "#e9ecf2"),
    footnote: cleanText($("noteText").value, 160),
  };
}

/** What is actually being drawn, in geographic coordinates. */
function subjectPolys() {
  if (isRegionMode()) return chosenRegion ? chosenRegion.polys : null;
  return chosen ? chosen.polys : null;
}

/** @returns {import("./render.js").SheetContent} */
function sheetContent() {
  const label =
    isRegionMode() && chosenRegion
      ? `${chosenRegion.name} · ${chosen ? chosen.name : ""}`.replace(/ · $/, "")
      : chosen
        ? chosen.name
        : "";
  return {
    polys: subjectPolys(),
    countryName: chosen ? chosen.name : "",
    label: chosen || chosenRegion ? label : "",
    mainOnly: mainOnly(),
  };
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
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = label; // text, never markup
      dd.append(a);
    } else dd.textContent = label;
    dl.append(dt, dd);
  };
  row(
    "Country outlines",
    "https://github.com/topojson/world-atlas",
    "Natural Earth admin-0, 1:50m, public domain — via world-atlas",
  );
  if (regions && isRegionMode()) {
    row(
      "Region outlines",
      "https://www.geoboundaries.org/",
      `geoBoundaries ADM1, simplified${regionIso ? " — " + regionIso : ""} · CC BY 4.0`,
    );
    row(
      "Country codes",
      "https://github.com/datasets/country-codes",
      "Numeric to alpha-3 crosswalk, public domain dedication",
    );
  }
  const caveats = [
    "Drawn in Web Mercator, the projection people know from web maps — which is what makes a shape recognisable, and also what stretches anything far from the equator.",
  ];
  if (mainOnly() && !isRegionMode())
    caveats.push(
      own(MAINLAND_OVERRIDE, chosen ? chosen.name : "")
        ? "The mainland here is defined by name rather than by nearness, because distance alone gets this country wrong — France without French Guiana, the United States without Alaska and Hawaii."
        : "Only the largest landmass and whatever lies within 400 km of it is drawn, so distant islands and overseas territories are left out.",
    );
  if (regions && isRegionMode())
    caveats.push(
      "Region outlines come from geoBoundaries, which requires attribution under CC BY 4.0. Its first level is not the same kind of division in every country, and these are the simplified outlines rather than the full-precision ones.",
    );
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !(chosen || chosenRegion);
}

/* ═══════════════════════════════════════════════════════════
   Picking
   ═══════════════════════════════════════════════════════════ */

const picker = createCountryPicker({
  items: () => COUNTRIES,
  forms: (c) => [c.name, ...(own(ALIASES, c.name) || [])],
  label: (c) => c.name,
  normalise: norm,
  onPick: pickCountry,
});

/** @param {CountryShape} c */
async function pickCountry(c) {
  if (!c) return;
  chosen = c;
  chosenRegion = null;
  regions = null;
  regionIso = "";
  $("country").value = c.name;
  picker.close();
  resetTurns();
  note("");
  if (isRegionMode()) await ensureRegions();
  fillRegions();
  refresh();
}

/**
 * Make sure the chosen country's regions are loaded. They belong to one
 * country, so they are refetched when it changes.
 *
 * @returns {Promise<boolean>} whether there are regions to offer
 */
async function ensureRegions() {
  if (!chosen) return false;
  if (regions && regionIso && regionIso === iso3For(chosen)) return true;
  regions = null;
  chosenRegion = null;
  progress(`Fetching regions of ${chosen.name}`, 0, true);
  try {
    const got = await loadRegionsFor(chosen);
    regions = got.regions;
    regionIso = got.iso3;
    if (!regions.length) {
      note(`geoBoundaries lists no first-level divisions for ${chosen.name}.`);
      return false;
    }
    note("");
    return true;
  } catch (e) {
    regions = null;
    note(
      (e && e.soft ? "" : "Couldn't fetch the regions: ") +
        cleanText(e && e.message, 300) +
        ". Country outlines still work.",
      !(e && e.soft),
    );
    return false;
  } finally {
    progress(null);
  }
}

/** Fill the region menu and select its first entry. */
function fillRegions() {
  const sel = $("region");
  const list = regions || [];
  sel.replaceChildren(...list.map((r, i) => new Option(r.name, String(i))));
  sel.disabled = !list.length;
  chosenRegion = list.length ? list[0] : null;
  $("regionHint").textContent = !chosen
    ? ""
    : list.length
      ? `${list.length} first-level divisions${regionIso ? " · " + regionIso : ""}`
      : "";
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

/** Redraw the outline after any change. */
function refresh() {
  const token = ++busy;
  syncUI();
  if (!subjectPolys()) {
    $("sheetWrap").hidden = true;
    $("empty").style.display = "block";
    $("sources").hidden = true;
    return;
  }
  try {
    drawSheet($("sheet"), currentOptions(), sheetContent());
    if (token !== busy) return;
    $("sheetWrap").hidden = false;
    $("empty").style.display = "none";
    renderSources();
  } catch (e) {
    note("Couldn't draw the outline: " + cleanText(e && e.message, 80), true);
  }
  syncUI();
}

/** Enable, disable and label the controls that depend on other controls. */
function syncUI() {
  const ready = !!subjectPolys();
  const transparent = $("bgNone").checked || $("fillNone").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
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

function resetTurns() {
  $("rotate").value = "0";
  $("flipH").setAttribute("aria-pressed", "false");
  $("flipV").setAttribute("aria-pressed", "false");
}

/**
 * Render the outline at full size and download it.
 *
 * @param {string} type MIME type
 * @param {string} ext file extension
 */
async function exportSheet(type, ext) {
  const opts = currentOptions();
  if (type === "image/jpeg") {
    opts.bgNone = false;
    opts.hole = false;
  }
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts, sheetContent());
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The filename shouldn't give away what the picture is hiding.
    const subject = isRegionMode() && chosenRegion ? chosenRegion.name : chosen ? chosen.name : "";
    const slug =
      opts.name && subject
        ? slugify(subject)
        : hashSlug(subject + "|" + opts.rotate + "|" + opts.flipH + opts.flipV);
    downloadBlob(blob, `outline-${slug || "shape"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

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
  if (await ensureRegions()) fillRegions();
  refresh();
});
$("region").addEventListener("change", () => {
  const list = regions || [];
  const i = parseInt($("region").value, 10);
  chosenRegion = Number.isInteger(i) ? list[i] || null : null;
  resetTurns();
  refresh();
});
$("extMain").addEventListener("click", () => {
  setSeg($("extMain"), $("extAll"));
  refresh();
});
$("extAll").addEventListener("click", () => {
  setSeg($("extAll"), $("extMain"));
  refresh();
});

const refreshAfterTurn = debounce(refresh, 90);
for (const id of ["rotate", "margin", "lineWidth"])
  $(id).addEventListener("input", () => {
    syncUI();
    refreshAfterTurn();
  });
for (const [id, deg] of [
  ["rot0", "0"],
  ["rot90", "90"],
  ["rot180", "180"],
  ["rot270", "270"],
])
  $(id).addEventListener("click", () => {
    $("rotate").value = deg;
    syncUI();
    refresh();
  });
for (const id of ["flipH", "flipV"])
  $(id).addEventListener("click", () => {
    const b = $(id);
    b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true");
    refresh();
  });
for (const id of ["fillNone", "bgNone", "optName"])
  $(id).addEventListener("change", () => {
    syncUI();
    refresh();
  });

$("noteText").addEventListener("input", debounce(refresh, 300));

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
const refreshSoon = debounce(refresh, 400);
for (const id of ["customW", "customH"]) $(id).addEventListener("input", refreshSoon);

const refreshAfterCaption = debounce(refresh, 300);
$("capText").addEventListener("input", () => {
  $("capPosField").hidden = !cleanText($("capText").value, 120);
  refreshAfterCaption();
});
$("capTop").addEventListener("click", () => {
  setSeg($("capTop"), $("capBottom"));
  refresh();
});
$("capBottom").addEventListener("click", () => {
  setSeg($("capBottom"), $("capTop"));
  refresh();
});

bindColour("lineColor", "lineHex", refresh);
bindColour("fillColor", "fillHex", refresh);
bindColour("bgColor", "bgHex", refresh);
bindColour("capColor", "capHex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

syncUI();
progress("Loading country outlines", 0, true);
fetch(TOPO_URL)
  .then((r) => {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  })
  .then((topo) => {
    COUNTRIES = topoCountries(topo);
    if (!COUNTRIES.length) throw new Error("no usable outlines");
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — start typing`;
    input.focus();
    progress(null);
  })
  .catch((err) => {
    progress(null);
    note(
      "Couldn't load the country outlines: " +
        cleanText(err && err.message, 70) +
        ". Check your connection and reload.",
      true,
    );
  });
