/**
 * Licence plates — plate images from Wikimedia Commons, composed and blurred
 * for a quiz sheet, with the plate requirements from Wikipedia.
 *
 * Flow: pick a country → the app lists every image in its Commons plate
 * category → click thumbnails to put them on the sheet, optionally drawing
 * the areas to blur → export as PNG or JPG.
 *
 * This file holds the app's state, the panels and the wiring. Fetching lives
 * in commons-data.js and plate-spec.js, drawing in render.js, and the blur
 * region editor in editor.js.
 */

import { licenceAllows, licenceClass, subcategoriesOf, filesIn } from "../../shared/commons.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, progress, setSeg } from "../../shared/dom.js";
import { createImageLoader, TAINTED_MESSAGE } from "../../shared/images.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { cleanText, norm, slugify } from "../../shared/text.js";
import { clamp, own } from "../../shared/util.js";
import {
  attachCodes,
  fileInfo,
  guessSection,
  loadCountries,
  looksLikeDiagram,
} from "./commons-data.js";
import { MAX_FILES, MAX_SELECTED, SECTION_LABEL, SECTION_ORDER } from "./config.js";
import { createRegionEditor } from "./editor.js";
import { loadPlateSpec } from "./plate-spec.js";
import { drawSheet } from "./render.js";

import { addBackLink } from "../../shared/back-link.js";

addBackLink();

/** @typedef {import("./commons-data.js").Country} Country */
/** @typedef {import("./commons-data.js").Plate} Plate */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Country[]} */
let COUNTRIES = [];
/** @type {Country | null} */
let chosen = null;
/** @type {Plate[]} everything Commons offered */
let candidates = [];
/** @type {Plate[]} what's on the sheet, in order */
let selected = [];
/** Incremented by every redraw, so a slow one can tell it has been overtaken. */
let busy = 0;
/** Where the country list came from, for the sources panel. */
let sourceVia = "";
/** The share-alike warning is shown once per session. */
let shareAlikeWarned = false;
/** @type {import("./plate-spec.js").PlateSpec | null} from the Wikipedia infobox */
let spec = null;

const images = createImageLoader();

const editor = createRegionEditor({
  loadImage: images.load,
  imageCache: images.cache,
  onChange: () => refresh(),
  onRegionAdded: () => {
    setSeg($("blurRegions"), $("blurWhole"));
    refresh();
  },
});

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#e4e6ea"),
    bg: safeColour($("bgColor").value, "#12141a"),
    at: safeColour($("atColor").value, "#8b91a0"),
    transparent: $("optTransparent").checked,
    sections: $("optSections").checked,
    country: $("optCountry").checked,
    spec: $("optSpec").checked,
    specTop: isPressed("specTop"),
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
    blurWhole: isPressed("blurWhole"),
    blurAmount: clamp(+$("blurAmount").value, 0, 150),
  };
}

/** @returns {import("./render.js").SheetContent} */
const sheetContent = () => ({ country: chosen, plates: selected, spec, loadImage: images.load });

/** @param {Plate} rec */
const licenceAllowed = (rec) => licenceAllows($("licFilter").value, rec);

/* ═══════════════════════════════════════════════════════════
   Refresh
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

/** The "Plate requirements" card. */
function renderSpec() {
  const dl = $("specList");
  dl.replaceChildren();
  if (!spec) {
    $("specNote").textContent = chosen
      ? "No infobox was found for this country, so nothing is claimed about its plate requirements."
      : "";
    $("spec").hidden = !chosen;
    return;
  }
  for (const r of spec.rows) {
    const dt = document.createElement("dt");
    dt.textContent = r.label; // text, never markup
    const dd = document.createElement("dd");
    dd.className = "plain";
    dd.textContent = r.value;
    dl.append(dt, dd);
  }
  const front = spec.rows.find((r) => r.key === "front plate");
  const rear = spec.rows.find((r) => r.key === "rear plate");
  $("specNote").textContent =
    front || rear
      ? "Shown exactly as the article records them."
      : "This article's infobox does not state whether front and rear plates are required — it is not stated rather than not required.";
  $("spec").hidden = false;
}

/* ═══════════════════════════════════════════════════════════
   Sources
   ═══════════════════════════════════════════════════════════ */

/** The "Sources" card: a credit for every plate, plus caveats. */
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
    } else {
      dd.textContent = label;
    }
    dl.append(dt, dd);
  };

  selected.forEach((rec, i) => {
    row(
      `Plate ${i + 1}`,
      rec.describeUrl || "",
      rec.describeUrl
        ? `${rec.licence.label}${rec.author ? " · " + rec.author : ""} — file page`
        : "no file page recorded",
    );
  });
  if (chosen)
    row(
      "Category searched",
      `https://commons.wikimedia.org/wiki/${encodeURIComponent(chosen.title)}`,
      chosen.title,
    );
  if (sourceVia) row("Country list from", "", sourceVia);
  if (spec)
    row("Plate data read from", spec.url || "", `${spec.title} — English Wikipedia, CC BY-SA 4.0`);

  const sa = selected.filter((r) => r.licence.shareAlike);
  $("caveat").textContent =
    "Licences are read from each file's Commons metadata, which is parsed free text rather than structured data, so check the file page before relying on it." +
    (sa.length
      ? ` ${sa.length} selected ${sa.length === 1 ? "image is" : "images are"} share-alike, which may oblige you to license the finished sheet the same way.`
      : "");
  $("sources").hidden = false;
}

/* ═══════════════════════════════════════════════════════════
   Picker
   ═══════════════════════════════════════════════════════════ */

/**
 * The categories this country's own files sit in, commonest first. A category
 * holding a single file is no use as a filter.
 */
function renderCategoryFilter() {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const rec of candidates)
    for (const c of rec.cats || []) counts.set(c, (counts.get(c) || 0) + 1);

  const list = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 120);

  const sel = $("catFilter");
  const previous = sel.value;
  sel.replaceChildren(
    new Option(`All categories${candidates.length ? " (" + candidates.length + ")" : ""}`, ""),
    ...list.map(([name, n]) => new Option(`${name} (${n})`, name)),
  );
  sel.value = list.some(([name]) => name === previous) ? previous : "";
}

/** The picker grid of thumbnails. Both filters narrow together. */
function renderGrid() {
  const q = norm($("filter").value);
  const cat = $("catFilter").value;
  const list = candidates.filter(
    (r) =>
      licenceAllowed(r) &&
      (!cat || (r.cats || []).includes(cat)) &&
      (!q || (r.keywords || "").includes(q)),
  );
  $("pickerCount").textContent =
    `${list.length} shown of ${candidates.length} found · ${selected.length} of ${MAX_SELECTED} chosen` +
    ((q || cat) && !list.length ? " · nothing matches both" : "");
  $("pickerHint").textContent = "Click a thumbnail to add or remove it";

  $("grid").replaceChildren(...list.map(tileFor));
  $("picker").hidden = !candidates.length;
}

/**
 * @param {Plate} rec
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
  meta.append(lic);

  // The file name usually says whether a plate is current or historic, and a
  // year in it says so at a glance.
  const nameRow = document.createElement("div");
  nameRow.className = "row split";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = rec.title; // text, never markup
  name.title = rec.title;
  nameRow.append(name);
  if (rec.year) {
    const year = document.createElement("span");
    year.className = "year";
    year.textContent = rec.year;
    year.title = "Year found in the file name — check the file page to be sure";
    nameRow.append(year);
  }
  meta.append(nameRow);

  const who = document.createElement("span");
  who.className = "who";
  who.textContent = rec.author || "author not stated"; // text, never markup
  meta.append(who);

  const row = document.createElement("div");
  row.className = "row";
  const sel = document.createElement("select");
  for (const id of SECTION_ORDER) sel.append(new Option(own(SECTION_LABEL, id), id));
  sel.value = rec.section;
  sel.addEventListener("change", () => {
    rec.section = sel.value;
    refresh();
  });
  row.append(sel);

  const edit = document.createElement("button");
  edit.className = "edit";
  edit.type = "button";
  edit.textContent = "Blur";
  edit.addEventListener("click", () => editor.open(rec));
  row.append(edit);
  meta.append(row);

  if (rec.describeUrl) {
    const foot = document.createElement("div");
    foot.className = "row split";
    const link = document.createElement("a");
    link.href = rec.describeUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "File page";
    link.className = "filelink";
    link.title = "Open on Commons to check the date and description";
    foot.append(link);
    meta.append(foot);
  }

  tile.append(thumb, meta);
  return tile;
}

/** @param {Plate} rec */
function toggleSelect(rec) {
  const at = selected.indexOf(rec);
  if (at >= 0) selected.splice(at, 1);
  else if (selected.length >= MAX_SELECTED) {
    note(`${MAX_SELECTED} plates is as many as fit on one sheet.`);
    return;
  } else {
    selected.push(rec);
    if (rec.licence.shareAlike && !shareAlikeWarned) {
      shareAlikeWarned = true;
      note(
        "That image is share-alike, which can oblige you to publish the finished sheet under the same licence. The licence filter can hide these if that's a problem.",
      );
      renderGrid();
      refresh();
      return;
    }
  }
  note("");
  renderGrid();
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Country picking
   ═══════════════════════════════════════════════════════════ */

const picker = createCountryPicker({
  items: () => COUNTRIES,
  forms: (c) => [c.name, c.official, ...(c.alts || [])],
  code: (c) => c.code || "",
  label: (c) => c.official || c.name,
  onPick: pickCountry,
});

/**
 * List every image in a country's plate category and its subcategories, then
 * look up the plate requirements.
 *
 * @param {Country} c
 */
async function pickCountry(c) {
  if (!c) return;
  chosen = c;
  $("country").value = c.official || c.name;
  picker.close();
  candidates = [];
  selected = [];
  spec = null;
  editor.close();
  $("spec").hidden = true;
  $("grid").replaceChildren();
  note("");
  await refresh();

  progress("Asking Commons what it has", true);
  try {
    const subs = await subcategoriesOf(c.title, 60);
    const sources = [
      { title: c.title, label: c.title },
      ...subs.map((t) => ({ title: t, label: t })),
    ];

    const seen = new Set();
    /** @type {Array<{title: string, from: string}>} */
    const found = [];
    for (const src of sources) {
      if (found.length >= MAX_FILES) break;
      let titles;
      try {
        titles = await filesIn(src.title, 200);
      } catch {
        continue;
      }
      for (const t of titles) {
        if (seen.has(t) || found.length >= MAX_FILES) continue;
        seen.add(t);
        found.push({ title: t, from: src.label });
      }
    }
    if (!found.length) {
      note("Commons lists no files in that category or its subcategories.", true);
      return;
    }

    progress(`Reading licences for ${found.length} files`, true);
    const infos = await fileInfo(found.map((f) => f.title));
    const fromByTitle = new Map(
      found.map((f) => ["File:" + f.title.replace(/^File:/, ""), f.from]),
    );

    for (const rec of infos) {
      rec.section = guessSection(rec.title, fromByTitle.get("File:" + rec.title) || "", rec.cats);
      rec.diagram = looksLikeDiagram(rec);
    }
    infos.sort(
      (a, b) => (b.diagram ? 1 : 0) - (a.diagram ? 1 : 0) || a.title.localeCompare(b.title),
    );
    candidates = infos;
    renderCategoryFilter();
    renderGrid();

    // Requirements are a bonus; a failure here must not lose the plates.
    progress("Looking up plate requirements", true);
    try {
      spec = await loadPlateSpec(c);
    } catch {
      spec = null;
    }
    renderSpec();
    note(
      candidates.length >= MAX_FILES
        ? `Commons holds more than the ${MAX_FILES} files fetched, so this is the first part of its own ordering rather than a selection. Use the filters to find a particular plate.`
        : "",
    );
  } catch (e) {
    note("Commons didn't answer: " + cleanText(e && e.message, 60) + ".", true);
  } finally {
    progress(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Export
   ═══════════════════════════════════════════════════════════ */

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
        ? slugify(chosen.name)
        : hashSlug(selected.map((r) => r.pageid || r.title).join("|"));
    downloadBlob(blob, `plates-${slug || "sheet"}.${ext}`);
    note("");
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

$("blurWhole").addEventListener("click", () => {
  setSeg($("blurWhole"), $("blurRegions"));
  refresh();
});
$("blurRegions").addEventListener("click", () => {
  setSeg($("blurRegions"), $("blurWhole"));
  refresh();
});

const refreshAfterBlur = debounce(refresh, 220);
$("blurAmount").addEventListener("input", (/** @type {Event} */ e) => {
  $("blurOut").textContent =
    (+(/** @type {HTMLInputElement} */ (e.target).value) / 10).toFixed(1) + "%";
  refreshAfterBlur();
});

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
const refreshSoon = debounce(refresh, 400);
for (const id of ["customW", "customH"]) $(id).addEventListener("input", refreshSoon);

for (const id of ["optSections", "optCountry", "optTransparent", "optSpec"])
  $(id).addEventListener("change", () => {
    if (id === "optSpec") $("specPosField").hidden = !$("optSpec").checked;
    syncExportState();
    refresh();
  });

const refreshAfterCaption = debounce(refresh, 300);
$("capText").addEventListener("input", () => {
  $("capPosField").hidden = !cleanText($("capText").value, 120);
  $("specPosField").hidden = !$("optSpec").checked;
  refreshAfterCaption();
});
$("specTop").addEventListener("click", () => {
  setSeg($("specTop"), $("specBottom"));
  refresh();
});
$("specBottom").addEventListener("click", () => {
  setSeg($("specBottom"), $("specTop"));
  refresh();
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
$("specPosField").hidden = !$("optSpec").checked;
syncExportState();
progress("Loading the country list from Commons", true);
loadCountries()
  .then(async ({ list, via }) => {
    const seen = new Set();
    /** @param {string} n */
    const sortKey = (n) => n.replace(/^the\s+/i, "");
    COUNTRIES = list
      .filter((c) => !seen.has(c.name) && seen.add(c.name))
      .map((c) => ({ ...c, code: "", official: "", alts: [] }))
      .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
    // Codes are an improvement, not a requirement.
    try {
      await attachCodes(COUNTRIES);
    } catch {
      for (const c of COUNTRIES) {
        c.code = "";
        c.official = "";
        c.alts = [];
      }
    }
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — name or code`;
    input.focus();
    progress(null);
    sourceVia = via;
  })
  .catch((err) => {
    progress(null);
    const detail =
      Array.isArray(err && err.tried) && err.tried.length
        ? " Tried: " + err.tried.join("; ") + "."
        : "";
    note(
      "Couldn't get a country list from Wikimedia Commons." + detail + " Reload to try again.",
      true,
    );
  });
