/**
 * Subdivision clouds — a country's states, provinces or regions as a word
 * cloud, sized by population or area.
 *
 * Flow: pick a country → Wikidata lists its first-level divisions with their
 * figures (wikidata.js) → a random selection is drawn as a cloud (cloud.js,
 * render.js) → shuffle, resize, export.
 */

import { CLDR_VERSION, loadTerritories } from "../../shared/cldr.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, progress, setSeg } from "../../shared/dom.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { bareName, cleanText, slugify } from "../../shared/text.js";
import { clamp, rng } from "../../shared/util.js";
import { PALETTES, AREA_UNIT_NAME } from "./config.js";
import { detectAffix } from "./names.js";
import { drawSheet } from "./render.js";
import { loadSubdivisions } from "./wikidata.js";

/** @typedef {import("../../shared/cldr.js").Territory} Country */
/** @typedef {import("./wikidata.js").Subdivision} Subdivision */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Country[]} */
let COUNTRIES = [];
/** @type {Country | null} */
let chosen = null;
/** @type {Subdivision[]} everything Wikidata returned */
let subdivisions = [];
/** @type {Subdivision[]} those that can be drawn */
let usable = [];
/** @type {Subdivision[]} the current random selection */
let picked = [];
/** @type {import("./names.js").Affix | null} a word every name repeats, if there is one */
let affix = null;
/** Whether a complete measure exists to size by. */
let weighted = true;
/** Seed of the current shuffle; "Shuffle" advances it. */
let seed = 1;
/** Incremented by every redraw. */
let busy = 0;

/** @returns {"area" | "population"} */
const metric = () => (isPressed("byArea") ? "area" : "population");
/** @returns {"spiral" | "wrapped"} */
const layout = () => (isPressed("laySpiral") ? "spiral" : "wrapped");

/** @returns {string[]} */
function palette() {
  const chosenPal = PALETTES.find((p) => p.id === $("palette").value) || PALETTES[0];
  return chosenPal.colours;
}

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#22201c"),
    bg: safeColour($("bgColor").value, "#f7f4ee"),
    transparent: $("optTransparent").checked,
    rotate: $("optRotate").checked,
    dropAffix: $("optAffix").checked && !!affix,
    values: $("optValues").checked && weighted,
    country: $("optCountry").checked,
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
  };
}

/** @returns {import("./render.js").SheetContent} */
const sheetContent = () => ({
  country: chosen,
  picked,
  metric: metric(),
  weighted,
  affix,
  layout: layout(),
  colours: palette(),
});

/**
 * How many divisions carry a measure.
 *
 * A measure is offered only when every division has it. Drawing the seven
 * regions that carry a figure and quietly dropping the other three produces a
 * cloud that looks complete and is not, with nothing on the sheet to say so.
 *
 * @param {"population" | "area"} m
 */
function coverage(m) {
  const have = subdivisions.filter((s) => s[m] !== null).length;
  return {
    have,
    total: subdivisions.length,
    complete: subdivisions.length > 0 && have === subdivisions.length,
  };
}

/**
 * Work out what can be drawn and update the controls to match.
 *
 * `freshCountry` marks the case where the previous country's choices should
 * not carry over: whether to drop a repeated word was a decision about that
 * country's naming, and how many to show was about how many it had.
 *
 * @param {boolean} [freshCountry]
 */
function recomputeUsable(freshCountry) {
  const pop = coverage("population");
  const area = coverage("area");
  $("byPop").disabled = !pop.complete;
  $("byArea").disabled = !area.complete;
  // Land on a measure that actually works, rather than an empty cloud.
  if (metric() === "population" && !pop.complete && area.complete) setSeg($("byArea"), $("byPop"));
  else if (metric() === "area" && !area.complete && pop.complete) setSeg($("byPop"), $("byArea"));
  /*
    With no complete measure there is nothing to size by, but the names are
    still the point of the thing — so the cloud is drawn at one size rather
    than the country being turned away.
  */
  weighted = pop.complete || area.complete;
  usable = subdivisions.slice();
  const m = metric();
  const cov = m === "area" ? area : pop;
  $("optValues").disabled = !weighted;
  if (!weighted) $("optValues").checked = false;
  $("valuesRow").classList.toggle("off", !weighted);

  affix = detectAffix(usable.map((s) => s.name));
  $("affixRow").hidden = !affix;
  // Cleared either way, so a hidden label can never hold a previous country's word.
  $("affixLabel").textContent = affix
    ? `Drop the repeated ${affix.kind} "${affix.text}"` +
      (affix.count < usable.length ? ` (on ${affix.count} of ${usable.length})` : "")
    : "Drop the repeated word";
  if (freshCountry) $("optAffix").checked = true;

  const slider = $("count");
  const max = Math.max(1, usable.length);
  slider.max = String(max);
  slider.disabled = !usable.length;
  if (freshCountry) slider.value = String(Math.max(1, Math.round(max / 2)));
  else if (+slider.value > max || +slider.value < 1) slider.value = String(max);
  $("shuffle").disabled = !usable.length;

  /** @param {{have: number, total: number}} w */
  const shortfall = (w) => `${w.total - w.have} of ${w.total} have no recorded figure`;
  $("countHint").textContent = !subdivisions.length
    ? ""
    : !weighted
      ? `No complete figures — population: ${shortfall(pop)}; area: ${shortfall(area)}. The names are shown at one size.`
      : cov.complete
        ? `All ${subdivisions.length} divisions have a recorded ${m === "area" ? "area" : "population"}`
        : `${m === "area" ? "Area" : "Population"} is unavailable here: ${shortfall(cov)}.`;
  updateCountOut();
}

function updateCountOut() {
  $("countOut").textContent = usable.length ? `— ${$("count").value} of ${usable.length}` : "";
}

/** A fixed draw: changing colours or the caption must not reshuffle it. */
function repick() {
  const n = clamp(parseInt($("count").value, 10) || 1, 1, Math.max(1, usable.length));
  const pool = usable.slice();
  const rand = rng(seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  picked = pool.slice(0, n);
}

/* ═══════════════════════════════════════════════════════════
   Panels
   ═══════════════════════════════════════════════════════════ */

/** The "Sources" card, with caveats about Wikidata's figures. */
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
    "Subdivisions",
    "https://query.wikidata.org/",
    "Wikidata query service — first-level divisions, with population and area",
  );
  row("Country names", "https://cldr.unicode.org/", `Unicode CLDR ${CLDR_VERSION}`);
  for (const p of picked.slice(0, 12)) row(p.name, p.url, p.id);

  $("caveat").textContent = [
    "Wikidata decides what counts as a first-level division, and its answer is not always the obvious one — the United Kingdom gives four countries, and the United States includes the federal district and the territories alongside the states.",
    weighted
      ? `Every one of the ${subdivisions.length} divisions found carries the figure shown; a measure is not offered at all unless it is complete, so no region is quietly missing from the cloud.`
      : "",
    weighted
      ? "Sizes are logarithmic and relative to the regions shown, so they say which is bigger, not by how much."
      : "No complete set of population or area figures exists for this country, so every region is drawn at the same size and no figures are shown.",
    weighted && metric() === "area"
      ? `Areas are converted to ${AREA_UNIT_NAME}. A division recorded in a unit this app does not know counts as having no area, which withdraws the measure for that country rather than showing a figure under the wrong unit.`
      : "",
    affix && $("optAffix").checked
      ? `The repeated ${affix.kind} "${affix.text}" has been dropped from the names shown; any region whose shortened name would have matched another keeps its full one.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  $("sources").hidden = !picked.length;
}

/** The colour chips next to the palette menu. */
function renderSwatches() {
  $("swatches").replaceChildren(
    ...palette().map((c) => {
      const i = document.createElement("i");
      i.style.background = safeColour(c, "#888888");
      return i;
    }),
  );
}

/* ═══════════════════════════════════════════════════════════
   Country picking
   ═══════════════════════════════════════════════════════════ */

const picker = createCountryPicker({
  items: () => COUNTRIES,
  forms: (c) => [c.name, ...(c.alts || [])],
  code: (c) => c.code,
  label: (c) => c.name,
  onPick: pickCountry,
});

/**
 * Load a country's subdivisions and draw a first selection.
 *
 * @param {Country} c
 */
async function pickCountry(c) {
  if (!c) return;
  chosen = c;
  $("country").value = c.name;
  picker.close();
  subdivisions = [];
  usable = [];
  picked = [];
  affix = null;
  note("");
  refresh();
  progress("Asking Wikidata for the subdivisions", true);
  try {
    subdivisions = await loadSubdivisions(c.code);
    if (!subdivisions.length) {
      note("Wikidata lists no first-level divisions for this country.", true);
    }
  } catch (e) {
    note("Couldn't reach the Wikidata query service: " + cleanText(e && e.message, 60) + ".", true);
  } finally {
    progress(null);
  }
  recomputeUsable(true);
  repick();
  if (subdivisions.length && !weighted)
    note(
      "Wikidata has no complete set of figures for this country, so the regions are shown at one size with no numbers. The names are unaffected.",
    );
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

/** Redraw the cloud after any change. */
function refresh() {
  const token = ++busy;
  syncExportState();
  if (!picked.length) {
    $("sheetWrap").hidden = true;
    $("empty").style.display = chosen ? "none" : "block";
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
    note("Couldn't draw the cloud: " + cleanText(e && e.message, 80), true);
  }
  syncExportState();
}

/** Enable, disable and label the controls that depend on other controls. */
function syncExportState() {
  const ready = picked.length > 0;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("revealTag").hidden = !$("optCountry").checked;
}

/**
 * Render the cloud at full size and download it.
 *
 * @param {string} type MIME type
 * @param {string} ext file extension
 */
async function exportSheet(type, ext) {
  const opts = currentOptions();
  if (type === "image/jpeg" && opts.transparent) opts.transparent = false;
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts, sheetContent());
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    const slug =
      opts.country && chosen
        ? slugify(chosen.name)
        : hashSlug((chosen ? chosen.code : "") + "|" + seed + "|" + picked.length);
    downloadBlob(blob, `regions-${slug || "sheet"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

$("byPop").addEventListener("click", () => {
  setSeg($("byPop"), $("byArea"));
  recomputeUsable();
  repick();
  refresh();
});
$("byArea").addEventListener("click", () => {
  setSeg($("byArea"), $("byPop"));
  recomputeUsable();
  repick();
  refresh();
});
$("layWrap").addEventListener("click", () => {
  setSeg($("layWrap"), $("laySpiral"));
  refresh();
});
$("laySpiral").addEventListener("click", () => {
  setSeg($("laySpiral"), $("layWrap"));
  refresh();
});

const repickSoon = debounce(() => {
  repick();
  refresh();
}, 180);
$("count").addEventListener("input", () => {
  updateCountOut();
  repickSoon();
});
$("shuffle").addEventListener("click", () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  repick();
  refresh();
});

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
const refreshSoon = debounce(refresh, 400);
for (const id of ["customW", "customH"]) $(id).addEventListener("input", refreshSoon);

for (const id of ["optRotate", "optValues", "optCountry", "optTransparent", "optAffix"])
  $(id).addEventListener("change", () => {
    syncExportState();
    refresh();
  });
$("palette").addEventListener("change", () => {
  renderSwatches();
  refresh();
});

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

bindColour("fgColor", "fgHex", refresh);
bindColour("bgColor", "bgHex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

$("palette").replaceChildren(
  ...PALETTES.map((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    return o;
  }),
);
renderSwatches();
$("capPosField").hidden = !cleanText($("capText").value, 120);
syncExportState();
progress("Loading the country list", true);
loadTerritories()
  .then((list) => {
    COUNTRIES = list.sort((a, b) => bareName(a.name).localeCompare(bareName(b.name)));
    if (!COUNTRIES.length) throw new Error("no countries returned");
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — name or code`;
    input.focus();
    progress(null);
  })
  .catch((err) => {
    progress(null);
    note(
      "Couldn't load the country list: " +
        cleanText(err && err.message, 70) +
        ". Check your connection and reload.",
      true,
    );
  });
