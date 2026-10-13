/**
 * Flag colours — a country's flag measured pixel by pixel and drawn as a pie
 * chart of its colours.
 *
 * Flow: pick a country → Wikidata names its flag file → Commons renders it →
 * every pixel is counted (measure.js) → the colours are drawn as a chart
 * (render.js) → export.
 */

import { CLDR_VERSION, loadTerritories } from "../../shared/cldr.js";
import { commonsFileUrl } from "../../shared/commons.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, progress, setSeg } from "../../shared/dom.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { bareName, cleanText, slugify } from "../../shared/text.js";
import { clamp, own } from "../../shared/util.js";
import { ALIASES } from "./config.js";
import { flagFileFor, flagRendering, loadFlagImage } from "./flag-data.js";
import { histogram, quantise } from "./measure.js";
import { drawSheet } from "./render.js";

/** @typedef {import("../../shared/cldr.js").Territory} Country */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Country[]} */
let COUNTRIES = [];
/** @type {Country | null} */
let chosen = null;
/** @type {import("./flag-data.js").FlagRendering | null} */
let flagMeta = null;
/** @type {import("./measure.js").Slice[]} the colours on the chart */
let slices = [];
/** @type {{width: number, height: number, opaque: number, clear: number, distinct: number} | null} */
let measurement = null;
/** @type {import("./measure.js").Histogram | null} kept so re-slicing is instant */
let lastHistogram = null;
/** The browser refused to let the page read the flag's pixels. */
let tainted = false;
/** Incremented by every redraw. */
let busy = 0;

/** @returns {import("./measure.js").QuantiseOptions} */
function quantiseOptions() {
  return {
    fold: $("optFold").checked,
    threshold: clamp(+$("threshold").value || 10, 1, 50) / 1000,
    maxSlices: clamp(+$("maxSlices").value || 10, 2, 20),
  };
}

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#e8ecf3"),
    bg: safeColour($("bgColor").value, "#101319"),
    transparent: $("optTransparent").checked,
    percent: $("optPercent").checked,
    hex: $("optHex").checked,
    ring: $("optRing").checked,
    country: $("optCountry").checked,
    start: clamp(+$("startAngle").value || 0, 0, 359),
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
  };
}

/* ═══════════════════════════════════════════════════════════
   Panels
   ═══════════════════════════════════════════════════════════ */

/**
 * The flag itself, shown here and nowhere near the sheet. This panel is for
 * whoever is building the puzzle, and seeing the source is the quickest way
 * to tell that the right file was measured.
 */
function renderFlagShot() {
  const box = $("flagShot");
  box.replaceChildren();
  if (!flagMeta || !measurement) {
    box.hidden = true;
    return;
  }
  const img = document.createElement("img");
  img.src = flagMeta.src; // already host-checked
  img.alt = "";
  img.loading = "lazy";
  const cap = document.createElement("p");
  const ratio = measurement.height ? measurement.width / measurement.height : 0;
  cap.textContent =
    `Measured at ${measurement.width} × ${measurement.height}` +
    (ratio ? ` · ${ratio.toFixed(2)}:1` : "");
  box.append(img, cap);
  if (flagMeta.pageid) {
    const link = document.createElement("p");
    const a = document.createElement("a");
    a.href = commonsFileUrl(flagMeta.pageid);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "File page on Commons"; // text, never markup
    link.append(a);
    box.append(link);
  }
  box.hidden = false;
}

/** The breakdown card: one swatch per colour with its share and code. */
function renderSwatches() {
  $("swatchList").replaceChildren(
    ...slices.map((s) => {
      const wrap = document.createElement("div");
      wrap.className = "sw";
      const chip = document.createElement("i");
      chip.style.background = safeColour(s.colour, "#888888");
      const text = document.createElement("div");
      const pct = document.createElement("b");
      pct.textContent = `${(s.share * 100).toFixed(1)}%`;
      const code = document.createElement("span");
      code.textContent = s.colour.toUpperCase();
      text.append(pct, code);
      wrap.append(chip, text);
      return wrap;
    }),
  );
  renderFlagShot();
  $("breakdown").hidden = !slices.length;
}

/** The "Sources" card, with how the measurement was made. */
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
  row("Which file is the flag", "https://query.wikidata.org/", "Wikidata, flag image property");
  if (flagMeta && flagMeta.pageid)
    row(
      "Flag image",
      commonsFileUrl(flagMeta.pageid),
      `Wikimedia Commons${flagMeta.licence ? " · " + flagMeta.licence : ""} — file page`,
    );
  row("Country names", "https://cldr.unicode.org/", `Unicode CLDR ${CLDR_VERSION}`);

  const caveats = [];
  if (measurement) {
    caveats.push(
      `Measured from a ${measurement.width} × ${measurement.height} rendering, ` +
        `${measurement.opaque.toLocaleString()} pixels counted` +
        (measurement.clear
          ? `, ${measurement.clear.toLocaleString()} transparent ones left out`
          : "") +
        `, from ${measurement.distinct.toLocaleString()} distinct values.`,
    );
  }
  caveats.push(
    "The rendering keeps the flag's official proportions, so the shares are of the real flag rather than of a shape forced to a common aspect ratio.",
  );
  caveats.push(
    $("optFold").checked
      ? "Emblem and detail colours have been folded into the nearest main colour, so a coat of arms adds nothing of its own."
      : "Detail colours are shown separately where they are distinct and large enough, so an emblem contributes slices of its own.",
  );
  caveats.push(
    "Anti-aliasing along every edge produces shades that are in no sense flag colours; those are always assigned to the nearest real one.",
  );
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !slices.length;
}

/* ═══════════════════════════════════════════════════════════
   Country picking
   ═══════════════════════════════════════════════════════════ */

const picker = createCountryPicker({
  items: () => COUNTRIES,
  forms: (c) => [c.name, ...(c.alts || []), ...(own(ALIASES, c.code) || [])],
  code: (c) => c.code,
  label: (c) => c.name,
  onPick: pickCountry,
});

/**
 * Find, render and measure a country's flag.
 *
 * @param {Country} c
 */
async function pickCountry(c) {
  if (!c) return;
  chosen = c;
  flagMeta = null;
  slices = [];
  measurement = null;
  $("country").value = c.name;
  picker.close();
  note("");
  refresh();
  try {
    progress("Asking Wikidata which file is the flag", true);
    const fileTitle = await flagFileFor(c.code);
    if (!fileTitle) {
      note(`Wikidata has no flag image recorded for ${c.name}.`, true);
      return;
    }
    progress("Asking Commons to render it", true);
    flagMeta = await flagRendering(fileTitle);
    if (!flagMeta) {
      note("Commons couldn't render that file.", true);
      return;
    }
    progress("Counting pixels", true);
    const img = await loadFlagImage(flagMeta.src);
    const hist = histogram(img);
    measurement = {
      width: hist.width,
      height: hist.height,
      opaque: hist.opaque,
      clear: hist.clear,
      distinct: hist.counts.size,
    };
    lastHistogram = hist;
    recompute();
  } catch (e) {
    if (e && e.tainted) tainted = true;
    note(
      (tainted
        ? "This browser wouldn't let the page read the flag's pixels. Serving the file over http://localhost rather than opening it directly usually fixes it. "
        : "Couldn't measure the flag: ") +
        cleanText(e && e.message, 80) +
        ".",
      true,
    );
  } finally {
    progress(null);
  }
}

/** Re-slice the measured flag. This is instant, so the sliders can be dragged freely. */
function recompute() {
  if (!lastHistogram) {
    slices = [];
    refresh();
    return;
  }
  slices = quantise(lastHistogram, quantiseOptions());
  note(
    slices.length && measurement
      ? `${slices.length} ${slices.length === 1 ? "colour" : "colours"} from ` +
          `${measurement.distinct.toLocaleString()} distinct pixel values.`
      : "Nothing measurable in that flag.",
  );
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

/** Redraw the chart after any change. */
function refresh() {
  const token = ++busy;
  syncUI();
  if (!slices.length) {
    $("sheetWrap").hidden = true;
    $("empty").style.display = chosen ? "none" : "block";
    $("breakdown").hidden = true;
    $("sources").hidden = true;
    return;
  }
  try {
    drawSheet($("sheet"), currentOptions(), { country: chosen, slices });
    if (token !== busy) return;
    $("sheetWrap").hidden = false;
    $("empty").style.display = "none";
    renderSwatches();
    renderSources();
  } catch (e) {
    note("Couldn't draw the chart: " + cleanText(e && e.message, 80), true);
  }
  syncUI();
}

/** Enable, disable and label the controls that depend on other controls. */
function syncUI() {
  const ready = slices.length > 0 && !tainted;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("revealTag").hidden = !$("optCountry").checked;
  $("hexTag").hidden = !$("optHex").checked;
  $("foldHint").hidden = false;
  $("thresholdOut").textContent = (clamp(+$("threshold").value, 1, 50) / 10).toFixed(1) + "%";
  $("maxSlicesOut").textContent = $("maxSlices").value;
  $("startOut").textContent = $("startAngle").value + "°";
}

/**
 * Render the chart at full size and download it.
 *
 * @param {string} type MIME type
 * @param {string} ext file extension
 */
async function exportSheet(type, ext) {
  const opts = currentOptions();
  if (type === "image/jpeg" && opts.transparent) opts.transparent = false;
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts, { country: chosen, slices });
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The colour codes are as much of a giveaway as the name, so a sheet
    // showing either is named; otherwise the filename is a hash.
    const slug =
      (opts.country || opts.hex) && chosen
        ? slugify(chosen.name)
        : hashSlug(slices.map((s) => s.colour + s.count).join("|"));
    downloadBlob(blob, `flag-colours-${slug || "sheet"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

const recomputeSoon = debounce(recompute, 120);
for (const id of ["threshold", "maxSlices"])
  $(id).addEventListener("input", () => {
    syncUI();
    recomputeSoon();
  });
$("optFold").addEventListener("change", recompute);

const refreshAfterTurn = debounce(refresh, 90);
$("startAngle").addEventListener("input", () => {
  syncUI();
  refreshAfterTurn();
});

for (const id of ["optPercent", "optHex", "optRing", "optCountry", "optTransparent"])
  $(id).addEventListener("change", () => {
    syncUI();
    refresh();
  });

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

bindColour("fgColor", "fgHex", refresh);
bindColour("bgColor", "bgHex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

$("capPosField").hidden = !cleanText($("capText").value, 120);
syncUI();
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
