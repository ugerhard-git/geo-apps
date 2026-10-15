/**
 * Landmarks — a country's best-known sights, buildings and natural wonders,
 * as photographs on a quiz sheet.
 *
 * Flow: pick a country → its candidates come from a precomputed file in
 * data/ (Wikidata, ranked by how many Wikipedias have an article about each,
 * refreshed monthly by scripts/landmarks/build-data.mjs) → their photographs
 * come from Commons → click thumbnails to put them on the sheet, or swap a
 * photograph for another from the landmark's Commons category → export.
 *
 * Reading the data lives in data.js and drawing in render.js; the photo
 * layout and credits are shared with the endemics app (shared/photo-sheet.js).
 */

import { addBackLink } from "../../shared/back-link.js";
import { CLDR_VERSION, loadTerritories } from "../../shared/cldr.js";
import { fileInfos, filesIn, licenceAllows, licenceClass } from "../../shared/commons.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import {
  $,
  bindColour,
  bindScale,
  debounce,
  isPressed,
  note,
  progress,
  scaleOf,
  setSeg,
} from "../../shared/dom.js";
import { createImageLoader, TAINTED_MESSAGE } from "../../shared/images.js";
import { ALIASES } from "../../shared/map-countries.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { bareName, cleanText, norm, slugify } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import { ALT_PHOTOS, FULL_W, MAX_SELECTED, THUMB_W } from "./config.js";
import { kindMatches, loadCountry } from "./data.js";
import { drawSheet } from "./render.js";

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Country */
/** @typedef {import("./data.js").Landmark} Landmark */
/** @typedef {import("../../shared/commons.js").FileInfo} FileInfo */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Country[]} */
let COUNTRIES = [];
/** @type {Map<string, string>} country names by code, for "also in …" */
let NAMES = new Map();
/** When the data was last refreshed, from data/index.json. */
let dataUpdated = "";

/** @type {Country | null} */
let chosen = null;
/** @type {Landmark[]} the chosen country's landmarks that have a usable photograph */
let landmarks = [];
/** @type {Map<string, FileInfo>} the photograph used for each landmark, by id */
const photoOf = new Map();
/** @type {string[]} ids on the sheet, in order */
let selected = [];
/** @type {"all" | "built" | "natural"} */
let kindFilter = "all";
/** @type {Map<string, HTMLElement>} gallery tiles, built once per country */
const tiles = new Map();
/** The landmark whose other photographs are on show, if any. */
let altFor = "";
/** Incremented by every redraw and every country pick. */
let busy = 0;
let pickToken = 0;

const images = createImageLoader();

/** Commons' form of a file title: spaces, not underscores; first letter upper case. */
const fileTitle = (/** @type {string} */ name) => {
  const n = name.replace(/_/g, " ").trim();
  return "File:" + n.charAt(0).toUpperCase() + n.slice(1);
};

/** @param {string} id */
const byId = (id) => landmarks.find((l) => l.id === id) || null;

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#f1ebe0"),
    bg: safeColour($("bgColor").value, "#16130f"),
    at: safeColour($("atColor").value, "#a69c8a"),
    transparent: $("optTransparent").checked,
    names: $("optNames").checked,
    country: $("optCountry").checked,
    caption: cleanText($("capText").value, 120),
    captionScale: scaleOf("capSize"),
    creditScale: scaleOf("credSize"),
    capTop: isPressed("capTop"),
  };
}

/** @returns {import("./render.js").Photo[]} */
function selectedPhotos() {
  return selected
    .map((id) => {
      const l = byId(id);
      const f = photoOf.get(id);
      return l && f ? { ...f, name: l.name } : null;
    })
    .filter((p) => p !== null);
}

/** @returns {import("./render.js").SheetContent} */
const sheetContent = () => ({
  countryName: chosen ? chosen.name : "",
  photos: selectedPhotos(),
  loadImage: images.load,
});

/** @param {Landmark} l */
const licenceAllowed = (l) => {
  const f = photoOf.get(l.id);
  return !!f && licenceAllows($("licFilter").value, f);
};

/* ═══════════════════════════════════════════════════════════
   Gallery
   ═══════════════════════════════════════════════════════════ */

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 */
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text; // text, never markup
  return e;
}

/**
 * Build the gallery for a new country. Tiles are made once; filtering hides
 * them and choosing a photo updates its tile, so the thumbnails are never
 * thrown away and decoded again.
 */
function buildGrid() {
  tiles.clear();
  for (const l of landmarks) tiles.set(l.id, tileFor(l));
  $("grid").replaceChildren(...tiles.values());
  $("picker").hidden = !landmarks.length;
  filterGrid();
}

/** Show the tiles that pass the filters. */
function filterGrid() {
  const q = norm($("filter").value);
  let shown = 0;
  for (const l of landmarks) {
    const tile = tiles.get(l.id);
    if (!tile) continue;
    const show =
      kindMatches(l, kindFilter) &&
      licenceAllowed(l) &&
      (!q || norm(l.name + " " + l.types.join(" ")).includes(q));
    tile.hidden = !show;
    if (show) shown++;
  }
  $("pickerCount").textContent =
    `${shown} shown of ${landmarks.length} · ${selected.length} of ${MAX_SELECTED} chosen`;
}

/**
 * Bring one tile up to date: chosen or not, and its photograph.
 *
 * @param {string} id
 */
function updateTile(id) {
  const tile = tiles.get(id);
  const f = photoOf.get(id);
  if (!tile || !f) return;
  const on = selected.includes(id);
  tile.classList.toggle("on", on);
  const thumb = /** @type {HTMLElement} */ (tile.querySelector(".thumb"));
  thumb.title = on ? "Remove from the sheet" : "Put on the sheet";
  thumb.setAttribute("aria-pressed", String(on));
  const img = /** @type {HTMLImageElement} */ (tile.querySelector("img"));
  if (img.getAttribute("src") !== f.thumb) img.src = f.thumb;
  const lic = /** @type {HTMLElement} */ (tile.querySelector(".lic"));
  lic.className = "lic " + licenceClass(f.licence);
  lic.textContent = f.licence.label + (f.licence.shareAlike ? " · share-alike" : "");
  const page = /** @type {HTMLAnchorElement} */ (tile.querySelector("a.filelink"));
  page.href = f.describeUrl;
}

/**
 * A thumbnail that loads only when scrolled into view and decodes off the
 * main thread. `loading` is set before `src`, or the browser may already
 * have started fetching.
 *
 * @param {string} src
 */
function thumbImg(src) {
  const img = /** @type {HTMLImageElement} */ (el("img"));
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = "";
  img.src = src;
  return img;
}

/**
 * @param {Landmark} l
 * @returns {HTMLElement}
 */
function tileFor(l) {
  const f = /** @type {FileInfo} */ (photoOf.get(l.id));
  const on = selected.includes(l.id);
  const tile = el("div", "tile" + (on ? " on" : ""));

  const thumb = el("button", "thumb");
  thumb.type = "button";
  thumb.title = on ? "Remove from the sheet" : "Put on the sheet";
  thumb.setAttribute("aria-pressed", String(on));
  thumb.append(thumbImg(f.thumb), el("span", "rank", "#" + l.rank));
  thumb.addEventListener("click", () => toggleSelect(l.id));

  const meta = el("div", "meta");
  meta.append(el("b", "", l.name));
  meta.append(el("span", "fame", `in ${l.sl} Wikipedias`));

  const tags = el("div", "tags");
  if (l.kind === "built" || l.kind === "both") tags.append(el("span", "tag built", "built"));
  if (l.kind === "natural" || l.kind === "both") tags.append(el("span", "tag natural", "natural"));
  if (l.whs) tags.append(el("span", "tag whs", "World Heritage"));
  if (l.partOf && l.partOf.name) tags.append(el("span", "tag part", "part of " + l.partOf.name));
  if (l.also.length) {
    const names = l.also.map((c) => NAMES.get(c) || c);
    const warn = el("span", "tag also", "also in " + names.join(", "));
    warn.title = "This landmark lies in more than one country, so it may not point to this one.";
    tags.append(warn);
  }
  if (l.types.length) tags.append(el("span", "tag type", l.types.slice(0, 2).join(", ")));
  meta.append(tags);

  const foot = el("div", "row");
  const lic = el(
    "span",
    "lic " + licenceClass(f.licence),
    f.licence.label + (f.licence.shareAlike ? " · share-alike" : ""),
  );
  foot.append(lic);
  const links = el("span", "links");
  if (l.cat) {
    const other = /** @type {HTMLButtonElement} */ (el("button", "linkish", "Other photos"));
    other.type = "button";
    other.addEventListener("click", () => showAlternatives(l.id));
    links.append(other);
  }
  const page = /** @type {HTMLAnchorElement} */ (el("a", "filelink", "File"));
  page.href = f.describeUrl;
  page.target = "_blank";
  page.rel = "noopener noreferrer";
  links.append(page);
  foot.append(links);
  meta.append(foot);

  tile.append(thumb, meta);
  return tile;
}

/** @param {string} id */
function toggleSelect(id) {
  const at = selected.indexOf(id);
  if (at >= 0) selected.splice(at, 1);
  else if (selected.length >= MAX_SELECTED) {
    note(`${MAX_SELECTED} is as many as fit on one sheet.`);
    return;
  } else selected.push(id);
  note("");
  updateTile(id);
  filterGrid();
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Other photographs, from the landmark's Commons category
   ═══════════════════════════════════════════════════════════ */

/** @param {string} id */
async function showAlternatives(id) {
  const l = byId(id);
  if (!l || !l.cat) return;
  altFor = id;
  $("altTitle").textContent = `Other photos of ${l.name}`;
  $("altGrid").replaceChildren();
  $("altNote").textContent = "Loading…";
  $("alts").hidden = false;
  $("alts").scrollIntoView({ behavior: "smooth", block: "nearest" });
  try {
    const titles = (await filesIn("Category:" + l.cat, 100))
      .filter((t) => /\.(jpe?g|png|webp|tiff?)$/i.test(t))
      .slice(0, ALT_PHOTOS);
    const infos = (await fileInfos(titles, THUMB_W, FULL_W)).filter((f) =>
      licenceAllows($("licFilter").value, f),
    );
    if (altFor !== id) return; // another landmark was opened meanwhile
    $("altNote").textContent = infos.length
      ? "Click a photo to use it for this landmark."
      : "No other usable photos in its Commons category.";
    $("altGrid").replaceChildren(
      ...infos.map((f) => {
        const b = /** @type {HTMLButtonElement} */ (el("button", "alt"));
        b.type = "button";
        if (photoOf.get(id)?.pageid === f.pageid) b.classList.add("on");
        b.append(thumbImg(f.thumb), el("span", "lic " + licenceClass(f.licence), f.licence.label));
        b.addEventListener("click", () => {
          photoOf.set(id, f);
          if (!selected.includes(id) && selected.length < MAX_SELECTED) selected.push(id);
          for (const x of $("altGrid").children) x.classList.toggle("on", x === b);
          updateTile(id);
          filterGrid();
          refresh();
        });
        return b;
      }),
    );
  } catch (e) {
    if (altFor === id)
      $("altNote").textContent = "Couldn't load other photos: " + cleanText(e && e.message, 80);
  }
}

/* ═══════════════════════════════════════════════════════════
   Sources
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
    const dd = el("dd");
    const a = /** @type {HTMLAnchorElement} */ (el("a", "", label));
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    dd.append(a);
    dl.append(el("dt", "", term), dd);
  };
  row(
    "Which landmarks",
    "https://www.wikidata.org/",
    `Wikidata (CC0), ranked by the number of Wikipedias with an article${dataUpdated ? " · updated " + dataUpdated : ""}`,
  );
  selected.forEach((id, i) => {
    const f = photoOf.get(id);
    if (f)
      row(
        `Photograph ${i + 1}`,
        f.describeUrl,
        `${f.licence.label}${f.author ? " · " + f.author : ""} — file page`,
      );
  });
  row("Country names", "https://cldr.unicode.org/", `Unicode CLDR ${CLDR_VERSION}`);
  $("caveat").textContent = [
    "Fame is measured by how many language editions of Wikipedia have an article about a place. That favours places written about worldwide, and well-documented regions over others.",
    "Seas, mountain ranges and regions spanning several countries, towns and cities, and roads or tunnels are left out; the rest is Wikidata's classification, which has gaps.",
    "Landmarks marked “also in” lie in more than one country, so on their own they may point to a neighbour.",
  ].join(" ");
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

/** @param {Country} c */
async function pickCountry(c) {
  if (!c) return;
  const mine = ++pickToken;
  chosen = c;
  landmarks = [];
  selected = [];
  photoOf.clear();
  altFor = "";
  $("alts").hidden = true;
  $("country").value = c.name;
  picker.close();
  tiles.clear();
  $("grid").replaceChildren();
  note("");
  refresh();
  try {
    progress(`Loading the landmarks of ${c.name}`, true);
    const list = await loadCountry(c.code);
    if (mine !== pickToken) return;
    if (!list) {
      note(`There is no landmark data for ${c.name} yet.`, true);
      return;
    }
    if (!list.length) {
      note(`Wikidata lists no well-known landmarks with photographs for ${c.name}.`, true);
      return;
    }
    progress(`Fetching ${list.length} photographs from Commons`, true);
    const infos = await fileInfos(
      list.map((l) => fileTitle(l.file)),
      THUMB_W,
      FULL_W,
    );
    if (mine !== pickToken) return;
    const byTitle = new Map(infos.map((f) => [f.title, f]));
    for (const l of list) {
      const f = byTitle.get(fileTitle(l.file));
      if (f) photoOf.set(l.id, f);
    }
    landmarks = list.filter((l) => photoOf.has(l.id));
    if (!landmarks.length) {
      note("Landmarks were found, but none of their photographs could be loaded.", true);
      return;
    }
    const shared = landmarks.filter((l) => l.also.length).length;
    note(
      `${landmarks.length} landmarks, best known first.` +
        (shared ? ` ${shared} also lie in another country — they're marked.` : ""),
    );
    buildGrid();
    refresh();
  } catch (e) {
    if (mine === pickToken)
      note("Couldn't load the landmarks: " + cleanText(e && e.message, 90) + ".", true);
  } finally {
    if (mine === pickToken) progress(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

async function refresh() {
  const token = ++busy;
  syncUI();
  if (!selected.length) {
    $("sheetWrap").hidden = true;
    $("empty").hidden = !!landmarks.length;
    $("sources").hidden = true;
    return;
  }
  try {
    await drawSheet($("sheet"), currentOptions(), sheetContent());
    if (token !== busy) return;
    $("sheetWrap").hidden = false;
    $("empty").hidden = true;
    if (images.tainted) note(TAINTED_MESSAGE, true);
    renderSources();
  } catch (e) {
    note("Couldn't draw the sheet: " + cleanText(e && e.message, 80), true);
  }
  syncUI();
}

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
 * @param {string} type
 * @param {string} ext
 */
async function exportSheet(type, ext) {
  const opts = currentOptions();
  if (type === "image/jpeg") opts.transparent = false;
  progress("Rendering for export", true);
  try {
    const canvas = document.createElement("canvas");
    await drawSheet(canvas, opts, sheetContent());
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // A landmark's name gives the country away as surely as the country's own.
    const slug =
      (opts.country || opts.names) && chosen ? slugify(chosen.name) : hashSlug(selected.join("|"));
    downloadBlob(blob, `landmarks-${slug || "sheet"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  } finally {
    progress(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

for (const [id, kind] of /** @type {const} */ ([
  ["kindAll", "all"],
  ["kindBuilt", "built"],
  ["kindNatural", "natural"],
]))
  $(id).addEventListener("click", () => {
    kindFilter = kind;
    for (const other of ["kindAll", "kindBuilt", "kindNatural"])
      $(other).setAttribute("aria-pressed", String(other === id));
    filterGrid();
  });

$("licFilter").addEventListener("change", () => {
  selected = selected.filter((id) => {
    const l = byId(id);
    return !!l && licenceAllowed(l);
  });
  for (const id of tiles.keys()) updateTile(id);
  filterGrid();
  refresh();
});
$("filter").addEventListener("input", debounce(filterGrid, 150));
$("altClose").addEventListener("click", () => {
  altFor = "";
  $("alts").hidden = true;
});

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

syncUI();
progress("Loading the country list", true);
fetch("data/index.json")
  .then((r) => (r.ok ? r.json() : null))
  .then((idx) => {
    const d = idx && typeof idx.updated === "string" ? idx.updated : "";
    dataUpdated = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
  })
  .catch(() => {});
loadTerritories()
  .then((list) => {
    COUNTRIES = list.sort((a, b) => bareName(a.name).localeCompare(bareName(b.name)));
    NAMES = new Map(COUNTRIES.map((c) => [c.code, c.name]));
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

// Caption and credit sizes: redraw as the sliders move, a moment after.
bindScale("capSize", debounce(refresh, 150));
bindScale("credSize", debounce(refresh, 150));
