/**
 * Endemic animals — photographs of species found only in one country,
 * arranged on a quiz sheet.
 *
 * Flow: pick a country → Wikipedia's endemic-fauna category lists its
 * species → their lead photographs come from Commons → click thumbnails to
 * put them on the sheet → export.
 *
 * This file holds the app's state, the panels and the wiring. Fetching lives
 * in species-data.js and drawing in render.js.
 */

import { CLDR_VERSION, loadTerritories } from "../../shared/cldr.js";
import { licenceAllows, licenceClass } from "../../shared/commons.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, progress, setSeg } from "../../shared/dom.js";
import { createImageLoader, TAINTED_MESSAGE } from "../../shared/images.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { bareName, cleanText, norm, slugify } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import { ALIASES, MAX_SELECTED } from "./config.js";
import { drawSheet } from "./render.js";
import { endemicsOf, photographs } from "./species-data.js";

import { addBackLink } from "../../shared/back-link.js";

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Country */
/** @typedef {import("./species-data.js").Species} Species */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Country[]} */
let COUNTRIES = [];
/** @type {Country | null} */
let chosen = null;
/** @type {Species[]} endemic to the chosen country */
let homeSpecies = [];
/** @type {Species[]} everything offered in the picker */
let candidates = [];
/** @type {Species[]} what's on the sheet, in order */
let selected = [];
/** Incremented by every redraw, so a slow one can tell it has been overtaken. */
let busy = 0;

const images = createImageLoader();

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#e9efe2"),
    bg: safeColour($("bgColor").value, "#12170f"),
    at: safeColour($("atColor").value, "#8e9c82"),
    transparent: $("optTransparent").checked,
    names: $("optNames").checked,
    country: $("optCountry").checked,
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
  };
}

/** @returns {import("./render.js").SheetContent} */
const sheetContent = () => ({ country: chosen, species: selected, loadImage: images.load });

/** @param {Species} rec */
const licenceAllowed = (rec) => licenceAllows($("licFilter").value, rec);

/* ═══════════════════════════════════════════════════════════
   Panels
   ═══════════════════════════════════════════════════════════ */

/** @type {Map<Species, HTMLElement>} picker tiles, built once per country */
const tiles = new Map();

/**
 * Build the picker for a new set of candidates. Tiles are made once;
 * filtering hides them and choosing one updates its tile, so thumbnails are
 * never thrown away and decoded again.
 */
function buildGrid() {
  tiles.clear();
  for (const rec of candidates) tiles.set(rec, tileFor(rec));
  $("grid").replaceChildren(...tiles.values());
  $("picker").hidden = !candidates.length;
  filterGrid();
}

/** Show the tiles that pass the filters, and the count. */
function filterGrid() {
  const q = norm($("filter").value);
  let shown = 0;
  for (const [rec, tile] of tiles) {
    const show = licenceAllowed(rec) && (!q || (rec.keywords || "").includes(q));
    tile.hidden = !show;
    tile.classList.toggle("on", selected.includes(rec));
    if (show) shown++;
  }
  $("pickerCount").textContent =
    `${shown} shown of ${candidates.length} · ${selected.length} of ${MAX_SELECTED} chosen`;
}

/**
 * @param {Species} rec
 * @returns {HTMLElement}
 */
function tileFor(rec) {
  const tile = document.createElement("div");
  tile.className = "tile" + (selected.includes(rec) ? " on" : "");

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  // `loading` before `src`, or the browser may already have started fetching.
  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = "";
  img.src = rec.thumb;
  thumb.append(img);
  thumb.addEventListener("click", () => toggleSelect(rec));

  const meta = document.createElement("div");
  meta.className = "meta";
  const name = document.createElement("b");
  name.textContent = rec.name; // text, never markup
  meta.append(name);

  const lic = document.createElement("span");
  lic.className = "lic " + licenceClass(rec.licence);
  lic.textContent = rec.licence.label + (rec.licence.shareAlike ? " · share-alike" : "");
  const foot = document.createElement("div");
  foot.className = "row";
  const link = document.createElement("a");
  link.href = rec.describeUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "File page";
  link.className = "filelink";
  foot.append(lic, link);
  meta.append(foot);

  tile.append(thumb, meta);
  return tile;
}

/** @param {Species} rec */
function toggleSelect(rec) {
  const at = selected.indexOf(rec);
  if (at >= 0) selected.splice(at, 1);
  else if (selected.length >= MAX_SELECTED) {
    note(`${MAX_SELECTED} is as many as fit on one sheet.`);
    return;
  } else selected.push(rec);
  filterGrid();
  refresh();
}

/** The "Sources" card, with the caveats about Wikipedia's categories. */
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
    "Which species are endemic",
    "https://en.wikipedia.org/wiki/Category:Endemic_fauna_by_country",
    "English Wikipedia, endemic-fauna categories, CC BY-SA 4.0",
  );
  selected.forEach((rec, i) => {
    row(
      `Photograph ${i + 1}`,
      rec.describeUrl,
      `${rec.licence.label}${rec.author ? " · " + rec.author : ""} — file page`,
    );
  });
  row("Country names", "https://cldr.unicode.org/", `Unicode CLDR ${CLDR_VERSION}`);

  const caveats = [
    "Membership of Wikipedia's endemic-fauna categories is an editorial judgement by its contributors rather than a derived fact, so coverage is uneven: a country may have endemic species that are not categorised, and a species absent here is not evidence it does not exist.",
    "Only articles carrying a lead photograph can appear, which skews the result towards vertebrates. A country's endemic species are in reality mostly insects, snails and other invertebrates, few of which are illustrated.",
    "Pages that are lists or overviews rather than single species are left out by their titles, which is a rule of thumb rather than a guarantee.",
  ];
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !selected.length;
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
 * Find a country's endemic species and their photographs.
 *
 * @param {Country} c
 */
async function pickCountry(c) {
  if (!c) return;
  chosen = c;
  homeSpecies = [];
  candidates = [];
  selected = [];
  $("country").value = c.name;
  picker.close();
  tiles.clear();
  $("grid").replaceChildren();
  note("");
  refresh();
  try {
    progress(`Looking up what lives only in ${c.name}`, true);
    const got = await endemicsOf(c);
    if (!got.taxa.length) {
      if (got.articles) {
        // The category exists; its articles simply carry no lead photograph.
        note(
          `Wikipedia lists ${got.articles} endemic species for ${c.name} in ` +
            `"${got.foundCategory.replace("Category:", "")}", but none of their articles ` +
            "carries a photograph, so there is nothing to put on a sheet.",
          true,
        );
      } else {
        const detail = got.tried && got.tried.length ? " Tried: " + got.tried.join("; ") + "." : "";
        note(
          `Wikipedia has no endemic-fauna category for ${c.name}.` +
            detail +
            " Endemism is concentrated in islands and the megadiverse countries; " +
            "most of continental Europe genuinely has none at species level.",
          true,
        );
      }
      return;
    }
    progress(`Fetching ${got.taxa.length} photographs from Commons`, true);
    homeSpecies = await photographs(got.taxa);
    if (!homeSpecies.length) {
      note(
        "Species were found for this country, but none of their photographs could be used.",
        true,
      );
      return;
    }
    await showCandidates();
  } catch (e) {
    note("Couldn't look up endemic species: " + cleanText(e && e.message, 90) + ".", true);
  } finally {
    progress(null);
  }
}

/** Offer the country's species in the picker. */
function showCandidates() {
  candidates = [...homeSpecies];
  note(`${homeSpecies.length} endemic to ${chosen ? chosen.name : "here"}.`);
  buildGrid();
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

/** Redraw the sheet preview after any change. */
async function refresh() {
  const token = ++busy;
  syncUI();
  if (!selected.length) {
    $("sheetWrap").hidden = true;
    $("empty").style.display = candidates.length ? "none" : "block";
    $("sources").hidden = true;
    return;
  }
  try {
    await drawSheet($("sheet"), currentOptions(), sheetContent());
    if (token !== busy) return;
    $("sheetWrap").hidden = false;
    $("empty").style.display = "none";
    if (images.tainted) note(TAINTED_MESSAGE, true);
    renderSources();
  } catch (e) {
    note("Couldn't draw the sheet: " + cleanText(e && e.message, 80), true);
  }
  syncUI();
}

/** Enable, disable and label the controls that depend on other controls. */
function syncUI() {
  const ready = selected.length > 0 && !images.tainted;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("revealTag").hidden = !$("optCountry").checked;
  $("nameTag").hidden = !$("optNames").checked;
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
    // A species' name identifies the country as surely as its own name, so
    // printing names counts as revealing.
    const slug =
      (opts.country || opts.names) && chosen
        ? slugify(chosen.name)
        : hashSlug(selected.map((r) => r.qid).join("|"));
    downloadBlob(blob, `endemics-${slug || "sheet"}.${ext}`);
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
  filterGrid();
  refresh();
});
$("filter").addEventListener("input", debounce(filterGrid, 150));

for (const id of ["optNames", "optCountry", "optTransparent"])
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
bindColour("atColor", "atHex", refresh);

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
