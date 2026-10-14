/**
 * Road signs — official sign artwork from Wikimedia Commons, arranged on a
 * quiz sheet.
 *
 * Flow: pick a country → the app collects its sign artwork class by class →
 * click thumbnails to put them on the sheet → export as PNG or JPG.
 *
 * This file holds the app's state, the panels around the sheet and the
 * wiring. Fetching lives in commons-data.js and drawing in render.js.
 */

import { licenceAllows, licenceClass } from "../../shared/commons.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, progress, setSeg } from "../../shared/dom.js";
import { createImageLoader, TAINTED_MESSAGE } from "../../shared/images.js";
import { safeColour } from "../../shared/colour.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { cleanText, norm, slugify } from "../../shared/text.js";
import { clamp, own } from "../../shared/util.js";
import { fileInfo, loadCountries, titlesForSection } from "./commons-data.js";
import {
  ALIASES,
  MAX_FILES,
  MAX_PER_CLASS,
  MAX_SELECTED,
  SECTION_LABEL,
  SECTION_ORDER,
  SECTIONS,
} from "./config.js";
import { drawSheet } from "./render.js";

import { addBackLink } from "../../shared/back-link.js";

addBackLink();

/** @typedef {import("./commons-data.js").Country} Country */
/** @typedef {import("./commons-data.js").Sign} Sign */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Country[]} every country Commons has diagrams for */
let COUNTRIES = [];
/** @type {Country | null} */
let chosen = null;
/** @type {Sign[]} everything found for the chosen country */
let candidates = [];
/** @type {Sign[]} what's on the sheet, in the order it was picked */
let selected = [];
/** Sign classes Commons has no category for, and ones cut short at the cap. */
/** @type {string[]} */
let missingSections = [];
/** @type {string[]} */
let truncated = [];
/** Incremented by every redraw, so a slow one can tell it has been overtaken. */
let busy = 0;

const images = createImageLoader();

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#eceff4"),
    bg: safeColour($("bgColor").value, "#14171c"),
    at: safeColour($("atColor").value, "#8e97a6"),
    transparent: $("optTransparent").checked,
    sections: $("optSections").checked,
    country: $("optCountry").checked,
    blur: $("optBlur").checked,
    blurAmount: clamp(+$("blurAmount").value, 0, 150),
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
  };
}

/** @returns {import("./render.js").SheetContent} */
const sheetContent = () => ({ country: chosen, signs: selected, loadImage: images.load });

/** @param {Sign} rec */
const licenceAllowed = (rec) => licenceAllows($("licFilter").value, rec);

/* ═══════════════════════════════════════════════════════════
   Panels
   ═══════════════════════════════════════════════════════════ */

/**
 * The categories the country's own files sit in, commonest first. This is
 * Commons' own classification rather than anything invented here, so it is
 * the most reliable way to find, say, every roundabout sign.
 */
function renderCategoryFilter() {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const rec of candidates)
    for (const c of rec.cats || []) counts.set(c, (counts.get(c) || 0) + 1);

  const list = [...counts.entries()]
    .filter(([, n]) => n >= 2) // a category of one is no filter
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 120);

  const sel = $("catFilter");
  const previous = sel.value;
  sel.replaceChildren(
    new Option(`All categories${candidates.length ? " (" + candidates.length + ")" : ""}`, ""),
    ...list.map(([name, n]) => new Option(`${name} (${n})`, name)),
  );
  // Keep the chosen category across a redraw when it still exists.
  sel.value = list.some(([name]) => name === previous) ? previous : "";
}

/**
 * The picker grid of thumbnails.
 *
 * The file name is not printed on a tile — "New Zealand road sign R2-3" would
 * give the country away — but it is still what the filter matches, so a
 * specific sign can be found among hundreds.
 */
function renderGrid() {
  const q = norm($("filter").value);
  const cat = $("catFilter").value;
  // Both filters narrow together: a category, and a name within it.
  const list = candidates.filter(
    (r) =>
      licenceAllowed(r) &&
      (!cat || (r.cats || []).includes(cat)) &&
      (!q || (r.keywords || "").includes(q)),
  );
  $("pickerCount").textContent =
    `${list.length} shown of ${candidates.length} found · ${selected.length} of ${MAX_SELECTED} chosen` +
    ((q || cat) && !list.length ? " · nothing matches both" : "");

  $("grid").replaceChildren(...list.map(tileFor));
  $("picker").hidden = !candidates.length;
}

/**
 * @param {Sign} rec
 * @returns {HTMLElement}
 */
function tileFor(rec) {
  const tile = document.createElement("div");
  tile.className = "tile" + (selected.includes(rec) ? " on" : "");

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  const img = document.createElement("img");
  img.src = rec.thumb;
  img.alt = "";
  img.loading = "lazy";
  thumb.append(img);
  thumb.addEventListener("click", () => toggleSelect(rec));

  const meta = document.createElement("div");
  meta.className = "meta";
  const lic = document.createElement("span");
  lic.className = "lic " + licenceClass(rec.licence);
  lic.textContent = rec.licence.label + (rec.licence.shareAlike ? " · share-alike" : "");

  const foot = document.createElement("div");
  foot.className = "row";
  const sel = document.createElement("select");
  for (const id of SECTION_ORDER) sel.append(new Option(own(SECTION_LABEL, id), id));
  sel.value = rec.section;
  sel.addEventListener("change", () => {
    rec.section = sel.value;
    renderGrid();
    refresh();
  });
  const link = document.createElement("a");
  link.href = rec.describeUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "File page";
  link.className = "filelink";
  link.title = "Open on Commons to check what this sign means";
  foot.append(sel, link);

  meta.append(lic, foot);
  tile.append(thumb, meta);
  return tile;
}

/** @param {Sign} rec */
function toggleSelect(rec) {
  const at = selected.indexOf(rec);
  if (at >= 0) selected.splice(at, 1);
  else if (selected.length >= MAX_SELECTED) {
    note(`${MAX_SELECTED} signs is as many as fit on one sheet.`);
    return;
  } else selected.push(rec);
  note("");
  renderGrid();
  refresh();
}

/** The "Sources" card: a credit for every sign, plus caveats. */
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

  selected.forEach((rec, i) => {
    row(
      `Sign ${i + 1}`,
      rec.describeUrl,
      `${rec.licence.label}${rec.author ? " · " + rec.author : ""} — file page`,
    );
  });

  const caveats = [
    "Sign artwork comes from Wikimedia Commons. Licences are read from each file's metadata, which is free text rather than structured data, so open a file page if you need to be sure. Attribution is drawn on the sheet for images whose licence asks for it.",
  ];
  if (missingSections.length)
    caveats.push(
      `Commons has no ${missingSections.join(", ")} category for this country. ` +
        "Sign classes are not shared across conventions — a country following the Vienna Convention " +
        "splits regulation into prohibitory, mandatory and priority signs, while one following the " +
        "MUTCD has a single regulatory class — so an absent class usually reflects which system the " +
        "country uses rather than a gap in the data.",
    );
  if (truncated.length)
    caveats.push(
      `The ${truncated.join(" and ")} categories hold more than the ${MAX_PER_CLASS} signs fetched, so what is shown is the first part of Commons' own ordering rather than a selection.`,
    );
  if (candidates.some((r) => r.historic))
    caveats.push(
      "Some files name themselves as historic or obsolete; those are marked in the picker and are a different puzzle from the signs in use today.",
    );
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !selected.length;
}

/* ═══════════════════════════════════════════════════════════
   Country picking
   ═══════════════════════════════════════════════════════════ */

const picker = createCountryPicker({
  items: () => COUNTRIES,
  forms: (c) => [c.name, c.standard, ...(c.alts || []), ...(own(ALIASES, c.code) || [])],
  code: (c) => c.code || "",
  label: (c) => c.standard || c.name,
  onPick: pickCountry,
});

/**
 * Collect every sign class's artwork for a country and show the picker.
 *
 * @param {Country} c
 */
async function pickCountry(c) {
  if (!c) return;
  chosen = c;
  $("country").value = c.standard || c.name;
  picker.close();
  candidates = [];
  selected = [];
  missingSections = [];
  truncated = [];
  $("grid").replaceChildren();
  note("");
  refresh();

  try {
    const perSection = clamp(Math.floor(MAX_FILES / SECTIONS.length), 8, MAX_PER_CLASS);
    /** @type {Sign[]} */
    const all = [];
    const seenTitles = new Set();
    const seenIds = new Set();
    /** @type {string[]} */
    const foundSections = [];

    for (const section of SECTIONS) {
      progress(`Looking for ${section.label.toLowerCase()} signs`, true);
      let titles;
      try {
        titles = await titlesForSection(c, section.type, perSection);
      } catch {
        titles = [];
      }
      // A Vienna country files the same sign under regulatory and prohibitory;
      // it belongs on the sheet once.
      titles = titles.filter((t) => !seenTitles.has(t) && seenTitles.add(t));
      if (!titles.length) {
        missingSections.push(section.label.toLowerCase());
        continue;
      }
      // A class holding more than the cap is reported, not silently shortened.
      if (titles.length >= perSection) truncated.push(section.label.toLowerCase());

      progress(`Reading ${titles.length} ${section.label.toLowerCase()} signs`, true);
      let recs;
      try {
        recs = await fileInfo(titles, section.id);
      } catch {
        recs = [];
      }
      recs = recs.filter((r) => !seenIds.has(r.pageid) && seenIds.add(r.pageid));
      if (recs.length) foundSections.push(section.label);
      all.push(...recs);
    }
    candidates = all;
    renderCategoryFilter();
    if (!candidates.length)
      note("Commons has no sign artwork in the categories tried for this country.", true);
    // Which classes exist says something real about the country; which are
    // absent usually says only which convention it follows.
    else
      note(
        `Found ${candidates.length} signs in ${foundSections.length} ` +
          `${foundSections.length === 1 ? "class" : "classes"}: ${foundSections.join(", ")}.` +
          (truncated.length
            ? ` Commons holds more ${truncated.join(" and ")} signs than fit here; use the filter to find a particular one.`
            : ""),
      );
    renderGrid();
  } catch (e) {
    note("Commons didn't answer: " + cleanText(e && e.message, 60) + ".", true);
  } finally {
    progress(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

/** Redraw the sheet preview after any change. */
async function refresh() {
  const token = ++busy;
  syncExportState();
  if (!selected.length) {
    $("sheetWrap").hidden = true;
    $("empty").style.display = candidates.length ? "none" : "block";
    $("sources").hidden = true;
    return;
  }
  progress("Drawing", true);
  try {
    await drawSheet($("sheet"), currentOptions(), sheetContent());
    if (token !== busy) return;
    $("sheetWrap").hidden = false;
    $("empty").style.display = "none";
    if (images.tainted) note(TAINTED_MESSAGE, true);
    renderSources();
  } catch (e) {
    note("Couldn't draw the sheet: " + cleanText(e && e.message, 80), true);
  } finally {
    if (token === busy) progress(null);
    syncExportState();
  }
}

/** Enable, disable and label the controls that depend on other controls. */
function syncExportState() {
  const ready = selected.length > 0 && !images.tainted;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("revealTag").hidden = !$("optCountry").checked;
  $("blurField").hidden = !$("optBlur").checked;
  $("blurOut").textContent = (clamp(+$("blurAmount").value, 0, 150) / 10).toFixed(1) + "%";
  $("textWarning").textContent = selected.length
    ? "Many signs carry words — STOP, ARRÊT, 止まれ — and the language gives the country away. Blur those, or choose pictograms."
    : "";
}

/**
 * Render the sheet at full size and download it.
 *
 * @param {string} type MIME type
 * @param {string} ext file extension
 */
async function exportSheet(type, ext) {
  const opts = currentOptions();
  if (type === "image/jpeg" && opts.transparent) opts.transparent = false;
  progress("Rendering for export", true);
  try {
    const canvas = document.createElement("canvas");
    await drawSheet(canvas, opts, sheetContent());
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The filename shouldn't give away what the sheet is hiding.
    const slug =
      opts.country && chosen
        ? slugify(chosen.standard || chosen.name)
        : hashSlug(selected.map((r) => r.pageid).join("|"));
    downloadBlob(blob, `signs-${slug || "sheet"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  } finally {
    progress(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

$("catFilter").addEventListener("change", renderGrid);
$("filter").addEventListener("input", debounce(renderGrid, 150));

$("licFilter").addEventListener("change", () => {
  selected = selected.filter(licenceAllowed);
  renderGrid();
  refresh();
});

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
const refreshSoon = debounce(refresh, 400);
for (const id of ["customW", "customH"]) $(id).addEventListener("input", refreshSoon);

for (const id of ["optSections", "optCountry", "optTransparent", "optBlur"])
  $(id).addEventListener("change", () => {
    syncExportState();
    refresh();
  });

const refreshAfterBlur = debounce(refresh, 220);
$("blurAmount").addEventListener("input", () => {
  syncExportState();
  refreshAfterBlur();
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
bindColour("atColor", "atHex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

$("capPosField").hidden = !cleanText($("capText").value, 120);
syncExportState();
progress("Loading the country list from Commons", true);
loadCountries()
  .then((list) => {
    COUNTRIES = list;
    if (!COUNTRIES.length) throw new Error("no countries returned");
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — start typing`;
    input.focus();
    progress(null);
  })
  .catch((err) => {
    progress(null);
    note(
      "Couldn't get a country list from Wikimedia Commons: " +
        cleanText(err && err.message, 70) +
        ". Reload to try again.",
      true,
    );
  });
