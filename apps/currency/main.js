/**
 * Currency sheets — banknotes and coins from Wikimedia Commons, with facts
 * from the currency's Wikipedia article, arranged on a quiz sheet.
 *
 * Flow: pick a country → CLDR says which currency it uses → the app collects
 * note and coin images and the article's facts and illustration → click
 * thumbnails to put them on the sheet → export as PNG or JPG.
 *
 * This file holds the app's state, the panels and the wiring. CLDR lives in
 * reference.js, Commons in commons-data.js, Wikipedia in currency-info.js and
 * drawing in render.js.
 */

import { CLDR_VERSION } from "../../shared/cldr.js";
import { licenceAllows, licenceClass } from "../../shared/commons.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, progress, setSeg } from "../../shared/dom.js";
import { createImageLoader, TAINTED_MESSAGE } from "../../shared/images.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { cleanText, slugify } from "../../shared/text.js";
import { clamp, own } from "../../shared/util.js";
import { categoryCandidates, fileInfo, filesIn } from "./commons-data.js";
import { MAX_FILES, MAX_SELECTED, SECTION_LABEL, SECTION_ORDER } from "./config.js";
import {
  allFactRows,
  factRows,
  findIllustration,
  loadCurrencyInfo,
  subdivisionNames,
} from "./currency-info.js";
import { loadReference } from "./reference.js";
import { drawSheet } from "./render.js";

import { addBackLink } from "../../shared/back-link.js";

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Country */
/** @typedef {import("./commons-data.js").Piece} Piece */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Country[]} */
let COUNTRIES = [];
/** @type {(code: string) => import("./reference.js").Currency | null} */
let currencyFor = () => null;

/** @type {import("./reference.js").Currency | null} the chosen country's currency */
let currency = null;
/** @type {import("./currency-info.js").CurrencyInfo | null} facts from Wikipedia */
let info = null;
/** @type {Piece[]} everything Commons offered */
let candidates = [];
/** @type {Piece[]} what's on the sheet, in order */
let selected = [];
/** Incremented by every redraw, so a slow one can tell it has been overtaken. */
let busy = 0;
/** What happened when looking for the article's illustration. */
let leadNote = "";
/** Whether the reader has set the "article illustration" switch by hand. */
let articleImageTouched = false;
/** @type {Piece | null} the article illustration, when it is not on Commons */
let articleImage = null;

const images = createImageLoader();

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#16201c"),
    bg: safeColour($("bgColor").value, "#f4f6f2"),
    at: safeColour($("atColor").value, "#65726b"),
    transparent: $("optTransparent").checked,
    sections: $("optSections").checked,
    facts: $("optFacts").checked,
    factsTop: isPressed("factsTop"),
    symbol: $("optSymbol").checked,
    baseUnit: $("optBaseUnit").checked,
    subdivision: $("optSubdivision").checked,
    specimen: $("optSpecimen").checked,
    articleImage: $("optArticleImage").checked,
    specimenAlpha: clamp(+$("specimenAlpha").value, 10, 90) / 100,
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
  };
}

/** @returns {import("./render.js").SheetContent} */
const sheetContent = () => ({
  pieces: selected,
  articleImage,
  currency,
  info,
  loadImage: images.load,
});

/** @param {Piece} rec */
const licenceAllowed = (rec) => licenceAllows($("licFilter").value, rec);

/* ═══════════════════════════════════════════════════════════
   Panels
   ═══════════════════════════════════════════════════════════ */

/** The facts card: everything the app knows; red marks what the sheet omits. */
function renderFacts() {
  const dl = $("factsList");
  dl.replaceChildren();
  if (!currency && !info) {
    $("facts").hidden = true;
    return;
  }

  for (const r of allFactRows(currentOptions(), currency, info)) {
    const dt = document.createElement("dt");
    dt.textContent = r.label; // text, never markup
    const dd = document.createElement("dd");
    dd.textContent = r.value;
    if (r.withheld) dd.className = "reveal";
    dl.append(dt, dd);
  }
  const subs = subdivisionNames(info);
  $("factsSub").textContent = info
    ? info.leadImageVia
      ? `Illustration found via the ${info.leadImageVia}.`
      : ""
    : "No currency article was found, so only CLDR data is shown.";
  $("factsNote").textContent = [
    "Red values are not on the sheet. Symbol, base unit and subdivision names each have their own switch.",
    info && !subs.length
      ? "This article records no subdivision name, so that switch adds nothing."
      : "",
    leadNote,
  ]
    .filter(Boolean)
    .join(" ");
  $("facts").hidden = false;
}

/** The "Sources" card. */
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
      `Image ${i + 1}`,
      rec.describeUrl,
      `${rec.licence.label}${rec.author ? " · " + rec.author : ""} — file page`,
    );
  });
  if (info) row("Currency facts", info.url, `${info.title} — English Wikipedia, CC BY-SA 4.0`);
  if ($("optArticleImage").checked && articleImage)
    row(
      "Article illustration",
      articleImage.describeUrl,
      `${articleImage.licence.label}${articleImage.nonFree ? " · not a free licence" : ""}` +
        `${articleImage.author ? " · " + articleImage.author : ""} — file page on Wikipedia`,
    );
  row("Country and currency", "", `Unicode CLDR ${CLDR_VERSION}`);

  $("caveat").textContent =
    "Licences come from each file's metadata, which is parsed free text rather than structured " +
    "data, so open a file page if you need to be sure. Attribution is drawn on the sheet for " +
    "images whose licence asks for it.";
  $("sources").hidden = false;
}

/* ═══════════════════════════════════════════════════════════
   Picker
   ═══════════════════════════════════════════════════════════ */

function renderGrid() {
  const list = candidates.filter(licenceAllowed);
  $("pickerCount").textContent =
    `${list.length} shown of ${candidates.length} found · ${selected.length} of ${MAX_SELECTED} chosen`;
  $("pickerHint").textContent = "Click a thumbnail to add or remove it";
  $("grid").replaceChildren(...list.map(tileFor));
  $("picker").hidden = !candidates.length;
}

/**
 * @param {Piece} rec
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

  let flag = null;
  if (rec.fromArticle) {
    flag = document.createElement("span");
    flag.className = "lic article";
    flag.textContent = "from the article";
  }

  /*
    The file name is not shown: Commons names files things like
    "50 Baht 1985 obverse.jpg", which gives the answer away to whoever is
    building the sheet. The year badge carries the historic-or-current
    signal without naming the country, and the file page has the rest.
  */
  const nameRow = document.createElement("div");
  nameRow.className = "row";
  if (rec.year) {
    const year = document.createElement("span");
    year.className = "year";
    year.textContent = rec.year;
    year.title = "Year found in the file name — open the file page to be sure";
    nameRow.append(year);
  } else {
    const unknown = document.createElement("span");
    unknown.className = "who";
    unknown.textContent = "no year in the file name";
    nameRow.append(unknown);
  }

  const who = document.createElement("span");
  who.className = "who";
  who.textContent = rec.author || "author not stated"; // text, never markup

  const foot = document.createElement("div");
  foot.className = "row";
  const sel = document.createElement("select");
  for (const id of SECTION_ORDER) sel.append(new Option(own(SECTION_LABEL, id), id));
  sel.value = rec.section;
  sel.addEventListener("change", () => {
    rec.section = sel.value;
    refresh();
  });
  const link = document.createElement("a");
  link.href = rec.describeUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "File page";
  link.className = "filelink";
  link.title = "Open on Commons to check the date and description";
  foot.append(sel, link);

  meta.append(...[lic, flag, nameRow, who, foot].filter((n) => n !== null));

  tile.append(thumb, meta);
  return tile;
}

/** @param {Piece} rec */
function toggleSelect(rec) {
  const at = selected.indexOf(rec);
  if (at >= 0) selected.splice(at, 1);
  else if (selected.length >= MAX_SELECTED) {
    note(`${MAX_SELECTED} images is as many as fit on one sheet.`);
    return;
  } else {
    selected.push(rec);
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
  forms: (c) => [c.name, ...(c.alts || [])],
  code: (c) => c.code,
  label: (c) => c.name,
  onPick: pickCountry,
});

/**
 * Find a country's currency, its notes and coins on Commons, and its facts
 * and illustration on Wikipedia.
 *
 * @param {Country} c
 */
async function pickCountry(c) {
  if (!c) return;
  $("country").value = c.name;
  picker.close();
  candidates = [];
  selected = [];
  info = null;
  articleImage = null;
  articleImageTouched = false;
  $("grid").replaceChildren();
  $("facts").hidden = true;
  note("");
  await refresh();

  currency = currencyFor(c.code);
  if (!currency) {
    note("CLDR lists no current legal tender for this territory.", true);
    return;
  }

  progress("Asking Commons what it has", true);
  try {
    const cats = categoryCandidates(c, currency);
    const seen = new Set();
    /** @type {Array<{title: string, section: "notes" | "coins"}>} */
    const found = [];
    for (const section of /** @type {const} */ (["notes", "coins"])) {
      for (const cat of cats[section]) {
        if (found.length >= MAX_FILES) break;
        let titles;
        try {
          titles = await filesIn(cat, 200);
        } catch {
          continue;
        }
        for (const t of titles) {
          if (seen.has(t) || found.length >= MAX_FILES) continue;
          seen.add(t);
          found.push({ title: t, section });
        }
      }
    }
    if (!found.length) {
      note("Commons lists no images in the categories tried for this country.", true);
    } else {
      progress(`Reading licences for ${found.length} files`, true);
      /** @type {Record<string, string[]>} */
      const bySection = { notes: [], coins: [] };
      for (const f of found) bySection[f.section].push(f.title);
      /** @type {Piece[]} */
      const all = [];
      for (const section of SECTION_ORDER) {
        if (bySection[section].length) all.push(...(await fileInfo(bySection[section], section)));
      }
      candidates = all;
      renderGrid();
    }

    // Facts are a bonus; a failure here must not lose the images.
    progress("Looking up currency facts", true);
    try {
      info = await loadCurrencyInfo(currency);
    } catch {
      info = null;
    }
    renderFacts();

    // The article's illustration goes to the front of the picker when it is
    // on Commons, or gets its own switch when it is only on Wikipedia.
    const illustration = await findIllustration(info);
    if (illustration.onCommons) {
      const lead = illustration.onCommons;
      candidates = [lead, ...candidates.filter((r) => r.pageid !== lead.pageid)];
      renderGrid();
    }
    articleImage = illustration.onWikipedia;
    leadNote = illustration.note;

    renderFacts();
    // Without this the switch is created and never shown.
    syncExportState();
    await refresh();
  } catch (e) {
    note("Commons didn't answer: " + cleanText(e && e.message, 60) + ".", true);
  } finally {
    progress(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

/** Images, the article illustration, or facts on their own — any of these is a sheet. */
function hasSheetContent() {
  if (selected.length) return true;
  if ($("optArticleImage").checked && articleImage) return true;
  if ($("optFacts").checked && factRows(currentOptions(), currency, info).length) return true;
  return false;
}

/** Redraw the sheet preview after any change. */
async function refresh() {
  const token = ++busy;
  syncExportState();
  if (!hasSheetContent()) {
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
  const ready = hasSheetContent() && !images.tainted;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("revealTag").hidden = !(
    $("optSymbol").checked ||
    $("optBaseUnit").checked ||
    $("optSubdivision").checked
  );

  /*
    Shown either way, so the option is discoverable, but inert and cleared
    when the article has no illustration — a ticked box that draws nothing
    is worse than a greyed one.
  */
  const box = $("optArticleImage");
  const tag = $("articleLicence");
  const row = $("articleImageRow");
  box.disabled = !articleImage;
  row.classList.toggle("off", !articleImage);
  if (!articleImage) box.checked = false;
  else if (!articleImageTouched) box.checked = true; // restore the default once one arrives
  tag.textContent = articleImage ? articleImage.licence.label : "none found";
  tag.title = articleImage ? "Hosted on Wikipedia rather than Commons" : "";
  $("factsPosField").hidden = !$("optFacts").checked;
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
      opts.baseUnit && currency
        ? slugify(currency.name)
        : hashSlug(selected.map((r) => r.pageid).join("|"));
    downloadBlob(blob, `currency-${slug || "sheet"}.${ext}`);
    note(
      selected.some((r) => r.section === "notes")
        ? "Saved. Reproducing banknotes is restricted by law in many countries independently of copyright — this app cannot check whether the exported size complies."
        : "",
    );
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  } finally {
    progress(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

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

for (const id of [
  "optSections",
  "optFacts",
  "optSymbol",
  "optBaseUnit",
  "optSubdivision",
  "optTransparent",
  "optSpecimen",
  "optArticleImage",
])
  $(id).addEventListener("change", () => {
    if (id === "optArticleImage") articleImageTouched = true;
    syncExportState();
    refresh();
  });

$("specimenAlpha").addEventListener("input", debounce(refresh, 220));

$("factsTop").addEventListener("click", () => {
  setSeg($("factsTop"), $("factsBottom"));
  refresh();
});
$("factsBottom").addEventListener("click", () => {
  setSeg($("factsBottom"), $("factsTop"));
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
bindColour("atColor", "atHex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

$("capPosField").hidden = !cleanText($("capText").value, 120);
syncExportState();
progress("Loading reference data", true);
loadReference()
  .then((ref) => {
    COUNTRIES = ref.countries;
    currencyFor = ref.currencyFor;
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — name or code`;
    input.focus();
    progress(null);
  })
  .catch((err) => {
    progress(null);
    note(
      "Couldn't load the reference data: " +
        cleanText(err && err.message, 70) +
        ". Check your connection and reload.",
      true,
    );
  });
