/**
 * Rivers — a country's rivers and lakes, with no borders, cities or names:
 * the shape of its drainage is the clue.
 *
 * Flow: CLDR names fill the picker and world-atlas supplies the outline that
 * rivers are cut to; Natural Earth's world river and lake files load in the
 * background, and the extra regional files (Europe, North America,
 * Australia) only when a country needs them → pick a country → style →
 * export. Reading the files lives in data.js, cutting rivers to the border in
 * clip.js, drawing in render.js.
 */

import { addBackLink } from "../../shared/back-link.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, setSeg } from "../../shared/dom.js";
import { MAINLAND_OVERRIDE, isNum } from "../../shared/geo.js";
import { ALIASES, loadMapCountries } from "../../shared/map-countries.js";
import { getLargeJson } from "../../shared/net.js";
import { projectCountry } from "../../shared/projection.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { cleanText, slugify } from "../../shared/text.js";
import { clamp, own } from "../../shared/util.js";
import { boxOfPolys } from "../../shared/world.js";
import { Region, clipLines } from "./clip.js";
import { BORDER_KM, BORDER_RUN_KM, LAKES_URL, MAX_BYTES, REGIONAL, RIVERS_URL } from "./config.js";
import { parseLakes, parseRivers } from "./data.js";
import { drawSheet } from "./render.js";

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Territory */
/** @typedef {import("../../shared/world.js").CountryShape} CountryShape */
/** @typedef {import("./data.js").Line} Line */
/** @typedef {import("./data.js").Lake} Lake */
/** @typedef {import("./render.js").SheetContent} SheetContent */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Territory[]} */
let COUNTRIES = [];
/** @type {(t: Territory) => CountryShape | null} */
let shapeFor = () => null;

/**
 * One downloadable file: its state, and what it held once parsed.
 *
 * @template T
 * @typedef {object} Source
 * @property {string} label what the loading bar says
 * @property {"idle" | "loading" | "ready" | "failed"} state
 * @property {T | null} data
 * @property {number | undefined} frac download progress
 * @property {Promise<void> | null} job
 */

/** @type {Source<Line[]>} */
const rivers = { label: "rivers", state: "idle", data: null, frac: undefined, job: null };
/** @type {Source<Lake[]>} */
const lakes = { label: "lakes", state: "idle", data: null, frac: undefined, job: null };
/** @type {Map<string, Source<Line[]>>} */
const regional = new Map(
  REGIONAL.map((r) => [
    r.id,
    {
      label: "more " + r.id.replace("_", " ") + "n rivers",
      state: "idle",
      data: null,
      frac: undefined,
      job: null,
    },
  ]),
);
let countriesDone = false;

/** @type {Territory | null} */
let chosen = null;
/** @type {CountryShape | null} */
let shape = null;

/** The clipped rivers of the current choice, and what they were computed for. */
let cacheKey = "";
/** @type {SheetContent | null} */
let cached = null;

const mainOnly = () => isPressed("extMain");
const detailed = () => isPressed("detailMore");

/* ═══════════════════════════════════════════════════════════
   Loading
   ═══════════════════════════════════════════════════════════ */

/** Show what is still downloading. */
function showLoading() {
  const bar = $("bar");
  const busy = [rivers, lakes, ...regional.values()].filter((s) => s.state === "loading");
  if (!countriesDone || busy.length) {
    const label = !countriesDone
      ? "Loading countries"
      : "Loading " + busy.map((s) => s.label).join(" and ");
    const frac = countriesDone && busy.length === 1 ? busy[0].frac : undefined;
    bar.style.display = "block";
    bar.classList.toggle("pending", !isNum(frac));
    if (isNum(frac)) bar.firstElementChild.style.width = Math.round(clamp(frac, 0, 1) * 100) + "%";
    $("loadLabel").textContent = label;
  } else {
    bar.style.display = "none";
    bar.classList.remove("pending");
    $("loadLabel").textContent = "";
  }
}

/**
 * Fetch and parse a file once; later calls share the same job.
 *
 * @template T
 * @param {Source<T>} source
 * @param {string} url
 * @param {(json: any) => T} parse
 * @returns {Promise<void>}
 */
function ensure(source, url, parse) {
  if (source.job) return source.job;
  source.state = "loading";
  showLoading();
  source.job = getLargeJson(url, MAX_BYTES, (frac) => {
    source.frac = frac;
    showLoading();
  })
    .then((json) => {
      source.data = parse(json);
      source.state = "ready";
    })
    .catch((e) => {
      source.state = "failed";
      note(`Couldn't load the ${source.label}: ${cleanText(e && e.message, 70)}.`, true);
    })
    .finally(() => {
      cacheKey = ""; // what is drawn may change
      showLoading();
      if (chosen) refresh();
    });
  return source.job;
}

/** The regional files that cover the chosen country, if the detail is wanted. */
function regionsFor() {
  if (!shape || !detailed()) return [];
  const b = boxOfPolys(shape.polys);
  if (!b) return [];
  return REGIONAL.filter(
    (r) => b.w <= r.box.e && b.e >= r.box.w && b.s <= r.box.n && b.n >= r.box.s,
  );
}

/** Start whatever downloads the current choice needs. */
function fetchNeeded() {
  ensure(rivers, RIVERS_URL, parseRivers);
  if ($("optLakes").checked) ensure(lakes, LAKES_URL, parseLakes);
  for (const r of regionsFor())
    ensure(/** @type {Source<Line[]>} */ (regional.get(r.id)), r.url, parseRivers);
}

/* ═══════════════════════════════════════════════════════════
   What to draw
   ═══════════════════════════════════════════════════════════ */

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    water: safeColour($("waterColor").value, "#5bb8f0"),
    weight: clamp(+$("weight").value || 100, 30, 300) / 100,
    lakes: $("optLakes").checked,
    outline: $("optOutline").checked,
    bg: safeColour($("bgColor").value, "#0f1115"),
    bgNone: $("bgNone").checked,
    margin: clamp(+$("margin").value || 0, 0, 30) / 100,
    name: $("optName").checked,
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
    capColour: safeColour($("capColor").value, "#e9ecf2"),
    footnote: cleanText($("noteText").value, 160),
  };
}

/**
 * The rivers and lakes of the chosen country, cut to its border. Cutting is
 * the slow part, so the result is kept until the country, the extent or the
 * loaded files change.
 *
 * @returns {SheetContent | null}
 */
function sheetContent() {
  if (!chosen || !shape) return null;
  const regions = regionsFor().filter((r) => regional.get(r.id)?.state === "ready");
  const key = [chosen.code, mainOnly(), regions.map((r) => r.id).join(","), lakes.state].join("|");
  if (key === cacheKey && cached) return cached;

  const { shape: plane, boxes } = projectCountry(shape.polys, mainOnly(), shape.name);
  const region = new Region(plane, BORDER_KM);
  /** @type {Line[]} */
  const lines = [...(rivers.data || [])];
  for (const r of regions) lines.push(...(regional.get(r.id)?.data || []));
  const pieces = clipLines(lines, region, BORDER_RUN_KM);

  /** @type {SheetContent["lakes"]} */
  const touching = [];
  const b = region.box;
  for (const lake of lakes.data || []) {
    for (const shift of [0, 2 * Math.PI]) {
      const lb = lake.box;
      if (lb.x1 + shift >= b.x0 && lb.x0 + shift <= b.x1 && lb.y1 >= b.y0 && lb.y0 <= b.y1) {
        touching.push({ lake, shift });
        break;
      }
    }
  }
  // The frame is the country itself, whatever the rivers do near its border.
  const frame = boxes.length
    ? {
        x0: Math.min(...boxes.map((x) => x.x0)),
        y0: Math.min(...boxes.map((x) => x.y0)),
        x1: Math.max(...boxes.map((x) => x.x1)),
        y1: Math.max(...boxes.map((x) => x.y1)),
      }
    : null;
  cached = { shape: plane, frame, pieces, lakes: touching, label: chosen.name };
  cacheKey = key;
  return cached;
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
  const regions = regionsFor().filter((r) => regional.get(r.id)?.state === "ready");
  row(
    "Rivers",
    "https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-rivers-lake-centerlines/",
    "Natural Earth rivers and lake centre-lines, 1:10m" +
      (regions.length ? ", with its regional supplement" : "") +
      " · public domain",
  );
  if ($("optLakes").checked)
    row(
      "Lakes",
      "https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/",
      "Natural Earth lakes and reservoirs, 1:10m · public domain",
    );
  row(
    "Border",
    "https://github.com/topojson/world-atlas",
    "Natural Earth admin-0, 1:50m, public domain — via world-atlas",
  );
  row("Country names", "https://cldr.unicode.org/", "Unicode CLDR");

  const caveats = [
    `Rivers are kept up to ${BORDER_KM} km outside the border, so rivers that form the border are drawn too; a river that only runs close to the border is kept when it does so for at least ${BORDER_RUN_KM} km.`,
    "Natural Earth adds smaller rivers only for Europe, North America and Australia, so elsewhere the map shows the larger rivers alone.",
    "Drawn in Web Mercator, so countries far from the equator look stretched.",
  ];
  if (mainOnly() && shape)
    caveats.push(
      own(MAINLAND_OVERRIDE, shape.name)
        ? "The mainland here is defined by a fixed area, because distance alone gets this country wrong."
        : "Only rivers on the largest landmass and the islands within 400 km of it are drawn.",
    );
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !chosen;
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
  cacheKey = "";
  $("country").value = c.name;
  picker.close();
  note("");
  fetchNeeded();
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

function hideSheet() {
  $("sheetWrap").hidden = true;
  $("empty").hidden = false;
}

/** Redraw the sheet after any change. */
function refresh() {
  syncUI();
  if (!chosen) {
    hideSheet();
    $("sources").hidden = true;
    return;
  }
  if (!shape) {
    hideSheet();
    note(
      `There is no outline for ${chosen.name} at this scale, so its rivers can't be picked out.`,
    );
    return;
  }
  if (rivers.state !== "ready") {
    if (rivers.state === "loading") note(`${chosen.name} will appear when the rivers have loaded.`);
    return;
  }
  const content = sheetContent();
  if (!content) return;
  const drawn = content.pieces.length || (currentOptions().lakes && content.lakes.length);
  if (!drawn) {
    hideSheet();
    renderSources();
    note(`Natural Earth shows no rivers in ${chosen.name} at this scale.`);
    return;
  }
  try {
    drawSheet($("sheet"), currentOptions(), content);
    $("sheetWrap").hidden = false;
    $("empty").hidden = true;
    if (rivers.state === "ready" && !/Couldn't/.test($("note").textContent || "")) note("");
    renderSources();
  } catch (e) {
    note("Couldn't draw the map: " + cleanText(e && e.message, 80), true);
  }
}

/** Enable, disable and label the controls that depend on other controls. */
function syncUI() {
  const ready = !!(chosen && shape && rivers.state === "ready");
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || $("bgNone").checked;
  $("dlJpg").title = $("bgNone").checked ? "JPEG cannot store transparency — export as PNG" : "";
  $("pngOnly").hidden = !$("bgNone").checked;
  $("bgColor").disabled = $("bgNone").checked;
  $("bgHex").disabled = $("bgNone").checked;
  $("revealTag").hidden = !$("optName").checked;
  $("weightOut").textContent = $("weight").value + "%";
  $("marginOut").textContent = $("margin").value + "%";
}

/**
 * Render the sheet at full size and download it.
 *
 * @param {string} type MIME type
 * @param {string} ext file extension
 */
async function exportSheet(type, ext) {
  const content = sheetContent();
  if (!chosen || !content) return;
  const opts = currentOptions();
  if (type === "image/jpeg") opts.bgNone = false;
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts, content);
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The filename shouldn't give away what the picture is hiding.
    const slug = opts.name ? slugify(chosen.name) : hashSlug(chosen.code + "|rivers");
    downloadBlob(blob, `rivers-${slug || "map"}.${ext}`);
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
    if (chosen) fetchNeeded();
    refresh();
  });
}
seg("extMain", "extAll");
seg("extAll", "extMain");
seg("detailMore", "detailMajor");
seg("detailMajor", "detailMore");
seg("capTop", "capBottom");
seg("capBottom", "capTop");

const refreshSoon = debounce(refresh, 120);
for (const id of ["weight", "margin"])
  $(id).addEventListener("input", () => {
    syncUI();
    refreshSoon();
  });
for (const id of ["optOutline", "bgNone", "optName"]) $(id).addEventListener("change", refresh);
$("optLakes").addEventListener("change", () => {
  if (chosen) fetchNeeded();
  refresh();
});

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
$("noteText").addEventListener("input", refreshAfterTyping);

bindColour("waterColor", "waterHex", refresh);
bindColour("bgColor", "bgHex", refresh);
bindColour("capColor", "capHex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

async function start() {
  showLoading();
  // The world file is needed for every country, so it starts straight away.
  ensure(rivers, RIVERS_URL, parseRivers);
  try {
    const got = await loadMapCountries();
    COUNTRIES = got.territories;
    shapeFor = got.shapeFor;
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — start typing`;
    input.focus();
    if (got.outlinesFailed)
      note(
        "Couldn't load the country borders, which rivers are cut to. Reload to try again.",
        true,
      );
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
