/**
 * Fact file — a country's facts from the CIA World Factbook (climate,
 * terrain, borders, economy, political system) on a clue card, with every
 * name that would give it away blacked out.
 *
 * Flow: the country list (index.json) and CLDR's country names load → pick
 * a country, and its fact file loads (data.js) → the ticked fields become
 * blocks, and the names in them are found (render.js, blackout.js) → the
 * card is drawn, and the "Names on the card" panel lists every name with a
 * box to black it out or show it → export.
 *
 *   config.js    the fields on offer, and fixed settings
 *   data.js      reading and checking the data files
 *   blackout.js  finding the names that could give the country away (pure)
 *   render.js    blocks, layout and drawing
 *
 * The data is built once by scripts/factfile/build-data.mjs: the Factbook
 * stopped in February 2026.
 */

import { addBackLink } from "../../shared/back-link.js";
import { loadTerritories } from "../../shared/cldr.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, progress, setSeg } from "../../shared/dom.js";
import { ALIASES } from "../../shared/map-countries.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { cleanText, slugify } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import { FIELDS, GROUPS, SOURCE_LINE } from "./config.js";
import { loadIndex, loadRecord } from "./data.js";
import { buildBlocks, drawSheet } from "./render.js";

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Territory */
/** @typedef {import("./data.js").CountryRecord} CountryRecord */
/** @typedef {import("./render.js").Block} Block */
/** @typedef {import("./blackout.js").Part} Part */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {import("./data.js").Index | null} */
let INDEX = null;
/** @type {Territory[]} */
let COUNTRIES = [];
/** @type {Territory | null} */
let chosen = null;
/** @type {CountryRecord | null} */
let record = null;
/** Names the user blacked out (true) or showed (false), overriding the app's choice. */
let overrides = new Map();
/** The fields whose list of names is open in the panel. */
const openNames = new Set();
/** Incremented per country, so a slow file can't replace a newer choice. */
let request = 0;

/** Whether a name is blacked out: the user's choice, or else the app's. */
const hidden = (/** @type {Part} */ p) =>
  p.term !== null && overrides.has(p.term) ? !!overrides.get(p.term) : p.auto;

/* ═══════════════════════════════════════════════════════════
   Options
   ═══════════════════════════════════════════════════════════ */

/** @returns {Set<string>} */
const chosenFields = () => new Set(FIELDS.filter((f) => $("f-" + f.id).checked).map((f) => f.id));

/** @returns {import("./render.js").SheetOptions} */
function sheetOptions() {
  return {
    paper: safeColour($("paperColor").value, "#f6f2ea"),
    ink: safeColour($("inkColor").value, "#23262d"),
    accent: safeColour($("accentColor").value, "#b4553a"),
    bar: safeColour($("barColor").value, "#23262d"),
    transparent: $("optTransparent").checked,
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
    note: cleanText($("noteText").value, 160),
    noteTop: isPressed("noteTop"),
    label: $("optName").checked && chosen ? chosen.name : "",
    credit: $("optSource").checked ? SOURCE_LINE : "",
    fill: $("optFill").checked,
  };
}

/** The current card's blocks, with the names in them found. */
function blocks() {
  if (!record || !INDEX || !chosen) return [];
  const names = [...record.names, chosen.name, ...(chosen.alts || [])];
  return buildBlocks(
    record,
    chosenFields(),
    { names, others: INDEX.others, broad: false, water: $("optWater").checked },
    { from: $("optFrom").checked },
  );
}

/* ═══════════════════════════════════════════════════════════
   Panels
   ═══════════════════════════════════════════════════════════ */

/** The field list in the side bar, grouped, with "from whom" under independence. */
function renderFieldList() {
  const nodes = [];
  for (const g of GROUPS) {
    const wrap = document.createElement("div");
    wrap.className = "fieldgroup";
    const h = document.createElement("h3");
    h.textContent = g.name;
    wrap.append(h);
    for (const f of FIELDS.filter((x) => x.group === g.id)) {
      wrap.append(checkbox("f-" + f.id, f.label, f.on));
      if (f.id === "independence") {
        const sub = checkbox("optFrom", "Say from whom", true);
        sub.classList.add("sub");
        wrap.append(sub);
      }
    }
    nodes.push(wrap);
  }
  $("fieldList").replaceChildren(...nodes);
}

/**
 * @param {string} id
 * @param {string} text
 * @param {boolean} on
 */
function checkbox(id, text, on) {
  const label = document.createElement("label");
  label.className = "chk";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.id = id;
  box.checked = on;
  box.addEventListener("change", refresh);
  const span = document.createElement("span");
  span.textContent = text;
  label.append(box, span);
  return label;
}

const WHY = {
  own: "points to the country",
  place: "a place name",
  country: "another country",
  water: "a sea, ocean or continent",
};

/**
 * "Names on the card": one collapsible section per field, each name with a
 * box that blacks it out (ticked) or shows it.
 *
 * @param {Block[]} bs
 */
function renderNames(bs) {
  const nodes = [];
  for (const b of bs) {
    /** @type {Map<string, Part>} */
    const terms = new Map();
    for (const p of b.parts || []) if (p.term && !terms.has(p.term)) terms.set(p.term, p);
    if (!terms.size) continue;
    const section = document.createElement("details");
    section.open = openNames.has(b.id);
    section.addEventListener("toggle", () => {
      if (section.open) openNames.add(b.id);
      else openNames.delete(b.id);
    });
    const summary = document.createElement("summary");
    const title = document.createElement("strong");
    title.textContent = b.label;
    const count = document.createElement("span");
    count.className = "count";
    const n = [...terms.values()].filter(hidden).length;
    count.textContent = n ? `${n} of ${terms.size} blacked out` : `${terms.size} shown`;
    summary.append(title, count);
    section.append(summary);
    for (const [term, part] of terms) {
      const row = document.createElement("label");
      row.className = "namerow";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = hidden(part);
      box.addEventListener("change", () => {
        overrides.set(term, box.checked);
        refresh();
      });
      const name = document.createElement("span");
      name.textContent = term; // text, never markup
      const why = document.createElement("span");
      why.className = "why";
      why.textContent = part.why ? WHY[part.why] : "";
      row.append(box, name, why);
      section.append(row);
    }
    nodes.push(section);
  }
  $("nameList").replaceChildren(...nodes);
  $("names").hidden = !nodes.length;
}

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
    a.textContent = label;
    dd.append(a);
    dl.append(dt, dd);
  };
  row(
    "Facts",
    "https://github.com/factbook/factbook.json",
    "CIA World Factbook, archived January 2026 · public domain",
  );
  row("Country names", "https://cldr.unicode.org/", "Unicode CLDR");
  const caveats = [
    "The CIA closed the World Factbook in February 2026, so these facts are as of January 2026 and will not be updated. Nothing tied to a person or an election is shown.",
    "Names are found automatically, so check the list of names below the card before you export.",
  ];
  if (record?.fields.system?.unsettled && $("f-system").checked)
    caveats.push(
      "The Factbook itself marks this country's system of government as interim or overtaken by events, so the card says it may have changed.",
    );
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !record;
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
async function pickCountry(c) {
  if (!c) return;
  chosen = c;
  $("country").value = c.name;
  picker.close();
  note("");
  const mine = ++request;
  progress("Loading the fact file", true);
  try {
    const rec = await loadRecord(c.code);
    if (mine !== request) return;
    record = rec;
    overrides = new Map();
    openNames.clear();
  } catch (e) {
    if (mine !== request) return;
    record = null;
    note(`Couldn't load the fact file for ${c.name}: ${cleanText(e && e.message, 70)}.`, true);
  } finally {
    if (mine === request) progress(null);
  }
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

function refresh() {
  syncUI();
  if (!record || !chosen) {
    $("sheetWrap").hidden = true;
    $("empty").hidden = false;
    $("names").hidden = true;
    $("sources").hidden = true;
    return;
  }
  const bs = blocks();
  try {
    drawSheet($("sheet"), sheetOptions(), bs, hidden);
    $("sheetWrap").hidden = false;
    $("empty").hidden = true;
    renderNames(bs);
    renderSources();
    if (!bs.length) note("Tick at least one field to put on the card.");
    else if (/^Tick at least/.test($("note").textContent || "")) note("");
  } catch (e) {
    note("Couldn't draw the card: " + cleanText(e && e.message, 80), true);
  }
}

function syncUI() {
  const ready = !!record;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("pngOnly").hidden = !transparent;
  $("paperColor").disabled = $("paperHex").disabled = transparent;
  $("revealTag").hidden = !$("optName").checked;
  $("optFrom").disabled = !$("f-independence").checked;
  $("capPosField").hidden = !cleanText($("capText").value, 120);
  $("notePosField").hidden = !cleanText($("noteText").value, 160);
}

/**
 * @param {string} type
 * @param {string} ext
 */
async function exportSheet(type, ext) {
  if (!record || !chosen) return;
  const opts = sheetOptions();
  if (type === "image/jpeg") opts.transparent = false;
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts, blocks(), hidden);
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The filename shouldn't give away what the card is hiding.
    const slug = opts.label ? slugify(chosen.name) : hashSlug(chosen.code + "|factfile");
    downloadBlob(blob, `factfile-${slug || "card"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

renderFieldList();

/**
 * @param {string} on
 * @param {string} off
 */
function seg(on, off) {
  $(on).addEventListener("click", () => {
    setSeg($(on), $(off));
    refresh();
  });
}
seg("capTop", "capBottom");
seg("capBottom", "capTop");
seg("noteTop", "noteBottom");
seg("noteBottom", "noteTop");

for (const id of ["optWater", "optTransparent", "optFill", "optSource", "optName"])
  $(id).addEventListener("change", refresh);

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
const refreshLater = debounce(refresh, 400);
for (const id of ["customW", "customH"]) $(id).addEventListener("input", refreshLater);
const refreshAfterTyping = debounce(refresh, 300);
for (const id of ["capText", "noteText"]) $(id).addEventListener("input", refreshAfterTyping);

for (const c of ["paper", "ink", "accent", "bar"]) bindColour(c + "Color", c + "Hex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

/**
 * The canvas falls back to another font silently if Inter hasn't arrived,
 * so the first card waits for it (briefly).
 */
async function fontsReady() {
  if (!document.fonts?.load) return;
  const loads = ["400", "600", "700"].map((w) => document.fonts.load(`${w} 30px "Inter"`));
  loads.push(document.fonts.load(`700 30px "Source Serif 4"`));
  await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, 4000))]);
}

async function start() {
  progress("Loading countries", true);
  syncUI();
  try {
    const [index, territories] = await Promise.all([loadIndex(), loadTerritories(), fontsReady()]);
    INDEX = index;
    COUNTRIES = territories.filter((t) => index.codes.has(t.code));
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — start typing`;
    input.focus();
  } catch (e) {
    note(
      "Couldn't load the list of countries: " +
        cleanText(e && e.message, 70) +
        ". Check your connection and reload.",
      true,
    );
  } finally {
    progress(null);
  }
}

start();
