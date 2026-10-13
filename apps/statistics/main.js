/**
 * Country statistics — up to four pie and bar charts about one country
 * (languages, religion, economy, land, health…) on a quiz sheet.
 *
 * Flow: pick a country → every statistic is fetched from its source
 * (sources.js, series.js) → the first four available are selected → tick
 * others on and off → export. Drawing lives in charts.js and render.js.
 */

import { CLDR_VERSION } from "../../shared/cldr.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, progress, setSeg } from "../../shared/dom.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { cleanText, slugify } from "../../shared/text.js";
import { GROUPS, MAX_CHARTS, PALETTES, RELIGION_YEAR, STATS } from "./config.js";
import { drawSheet } from "./render.js";
import { buildSeries } from "./series.js";
import { loadReference } from "./sources.js";

/** @typedef {import("../../shared/cldr.js").Territory} Country */
/** @typedef {import("./series.js").Series} Series */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Country[]} */
let COUNTRIES = [];
/** @type {Record<string, any>} CLDR territory info, for the languages chart */
let territoryInfo = {};
/** @type {Country | null} */
let chosen = null;
/** @type {Map<string, Series | null>} stat id → series, or null when unavailable */
let available = new Map();
/** @type {string[]} stat ids, in the order chosen */
let selected = [];
/** Incremented by every redraw. */
let busy = 0;

/** @returns {string[]} */
function palette() {
  const pal = PALETTES.find((p) => p.id === $("palette").value) || PALETTES[0];
  return pal.colours;
}

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#e8eaf0"),
    bg: safeColour($("bgColor").value, "#12141a"),
    transparent: $("optTransparent").checked,
    values: $("optValues").checked,
    source: $("optSource").checked,
    country: $("optCountry").checked,
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
    colours: palette(),
  };
}

/** @returns {import("./render.js").SheetContent} */
const sheetContent = () => ({ country: chosen, selected, available });

/* ═══════════════════════════════════════════════════════════
   Panels
   ═══════════════════════════════════════════════════════════ */

/**
 * One card per statistic, with what was found for it.
 *
 * @param {import("./config.js").Stat} stat
 * @returns {HTMLElement}
 */
function statCard(stat) {
  const series = available.get(stat.id);
  const wrap = document.createElement("div");
  wrap.className = "stat" + (selected.includes(stat.id) ? " on" : "") + (series ? "" : " missing");
  const top = document.createElement("div");
  top.className = "top";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = selected.includes(stat.id);
  box.disabled = !series;
  box.addEventListener("change", () => toggleStat(stat.id, box.checked));
  const name = document.createElement("strong");
  name.textContent = stat.title; // text, never markup
  top.append(box, name);
  const p = document.createElement("p");
  if (!series) p.textContent = "No data for this country.";
  else {
    const bits = [`${series.slices.length} categories`, series.note];
    if (series.folded) bits.push(`${series.folded} small ones gathered`);
    if (series.unit) bits.push(`shares of ${series.unit}`);
    if (series.dropped) bits.push(`${series.dropped} couldn't be read`);
    if (series.overHundred) bits.push("shares total over 100%");
    p.textContent = bits.filter(Boolean).join(" · ");
  }
  wrap.append(top, p);
  return wrap;
}

/** The statistics picker, grouped under headings. */
function renderStats() {
  const nodes = [];
  for (const group of GROUPS) {
    const inGroup = STATS.filter((st) => st.group === group.id);
    if (!inGroup.length) continue;
    const ready = inGroup.filter((st) => available.get(st.id)).length;
    const h = document.createElement("h3");
    h.textContent = group.name;
    // Say how many of the group are usable, so an all-grey heading explains itself.
    if (chosen) {
      const count = document.createElement("span");
      count.textContent = ready ? `${ready} of ${inGroup.length} available` : "none available here";
      h.append(count);
    }
    nodes.push(h, ...inGroup.map(statCard));
  }
  $("statList").replaceChildren(...nodes);
  $("picker").hidden = !chosen;
}

/** The "Sources" card, listing only the sources the sheet uses. */
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
  const used = new Set(
    selected
      .filter((id) => available.get(id))
      .map((id) => (STATS.find((s) => s.id === id) || { source: "" }).source),
  );
  if (used.has("CLDR"))
    row(
      "Languages",
      "https://cldr.unicode.org/",
      `Unicode CLDR ${CLDR_VERSION} — territory language population`,
    );
  if (used.has("Pew Research"))
    row(
      "Religion",
      "https://www.pewresearch.org/religion/2015/04/02/religious-projections-2010-2050/",
      `Pew Research Center, ${RELIGION_YEAR} estimate — via datasets/world-religion-projections, CC BY 4.0`,
    );
  if (used.has("World Bank"))
    row(
      "Indicators",
      "https://data.worldbank.org/",
      "World Bank open data — most recent year with a value, per indicator",
    );
  if (used.has("OWID"))
    row(
      "Electricity",
      "https://ourworldindata.org/grapher/share-elec-by-source",
      "Our World in Data, CC BY 4.0 — adapted from Ember and the Energy Institute",
    );
  if (used.has("Factbook")) {
    row(
      "Factbook archive",
      "https://github.com/factbook/factbook.json",
      "CIA World Factbook, public domain — archived snapshot, January 2026",
    );
    row(
      "Country codes",
      "https://github.com/datasets/country-codes",
      "FIPS to ISO 3166-1 crosswalk, public domain dedication",
    );
  }

  const caveats = [];
  if (selected.includes("languages"))
    caveats.push(
      "Language shares are each a percentage of the population and add up to more than 100%, because someone who speaks two languages counts in both. That is why they are drawn as bars rather than a pie.",
    );
  if (selected.includes("religion"))
    caveats.push(
      `Religion figures are Pew estimates for ${RELIGION_YEAR}; shares below 1% were rounded up to 1% in the published data, so a total can drift past 100%.`,
    );
  if (selected.some((id) => available.get(id)?.folded))
    caveats.push(
      "Where a chart had more categories than a pie can carry, the smallest were gathered into Other.",
    );
  if (used.has("Factbook"))
    caveats.push(
      "The CIA discontinued the World Factbook on 4 February 2026 and removed the site, so the Factbook figures come from an archived January 2026 snapshot and will not be updated. Its ethnic categories are the US government's coding of other countries' populations.",
    );
  if (selected.includes("ethnicity") && available.get("ethnicity")?.overHundred)
    caveats.push(
      "Ethnic shares total more than 100% because people could name more than one group, which is why they are bars rather than a pie.",
    );
  const droppedTotal = selected.reduce((t, id) => t + (available.get(id)?.dropped || 0), 0);
  if (droppedTotal)
    caveats.push(
      `${droppedTotal} ${droppedTotal === 1 ? "category was" : "categories were"} left out because the published figure was a range or an inequality rather than a number.`,
    );
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !selected.length;
}

/**
 * @param {string} id
 * @param {boolean} want
 */
function toggleStat(id, want) {
  if (want) {
    if (selected.length >= MAX_CHARTS) {
      note(`Four charts is as many as fit on one sheet.`);
      renderStats();
      return;
    }
    if (!selected.includes(id)) selected.push(id);
  } else {
    selected = selected.filter((s) => s !== id);
  }
  note("");
  renderStats();
  refresh();
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
 * Fetch every statistic for a country and select the first four available.
 *
 * @param {Country} c
 */
async function pickCountry(c) {
  if (!c) return;
  chosen = c;
  $("country").value = c.name;
  picker.close();
  available = new Map();
  selected = [];
  renderStats();
  note("");
  await refresh();
  progress("Fetching statistics", true);
  const missing = [];
  for (const stat of STATS) {
    progress(`Fetching ${stat.title.toLowerCase()}`, true);
    let series;
    try {
      series = await buildSeries(stat.id, c, territoryInfo);
    } catch {
      series = null;
    }
    available.set(stat.id, series);
    if (!series) missing.push(stat.title);
    renderStats();
  }
  progress(null);
  // Offer a sensible starting set rather than an empty sheet.
  selected = STATS.map((s) => s.id)
    .filter((id) => available.get(id))
    .slice(0, MAX_CHARTS);
  renderStats();
  note(missing.length ? `No data for: ${missing.join(", ")}. The rest are ready.` : "");
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

/** Redraw the sheet after any change. */
function refresh() {
  const token = ++busy;
  syncExportState();
  const drawable = selected.filter((id) => available.get(id));
  if (!drawable.length) {
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
    note("Couldn't draw the sheet: " + cleanText(e && e.message, 80), true);
  }
  syncExportState();
}

/** Enable, disable and label the controls that depend on other controls. */
function syncExportState() {
  const ready = selected.some((id) => available.get(id));
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
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts, sheetContent());
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The filename shouldn't give away what the sheet is hiding.
    const slug =
      opts.country && chosen
        ? slugify(chosen.name)
        : hashSlug((chosen ? chosen.code : "") + "|" + selected.join("|"));
    downloadBlob(blob, `statistics-${slug || "sheet"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
const refreshSoon = debounce(refresh, 400);
for (const id of ["customW", "customH"]) $(id).addEventListener("input", refreshSoon);

for (const id of ["optValues", "optSource", "optCountry", "optTransparent"])
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
progress("Loading reference data", true);
loadReference()
  .then((ref) => {
    COUNTRIES = ref.countries;
    territoryInfo = ref.territoryInfo;
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
