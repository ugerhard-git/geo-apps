/**
 * Keyboard layouts — a country's keyboard, key by key, with nothing to say
 * whose it is: where the Z sits, which accents have their own key, which
 * alphabet is printed beside the Latin one.
 *
 * Flow: the layout data (data/layouts.json, from Unicode CLDR) and CLDR's
 * country names load → pick a country, and its usual layout is drawn (the
 * others used there are in the Layout list) → the fonts for its scripts load
 * → the sheet is drawn (render.js) → export.
 *
 *   keys.js    key positions per shape, and what each keycap prints (pure)
 *   data.js    reading and checking the layout file
 *   shared/fonts.js  Noto fonts per script, loaded on demand
 *   render.js  drawing the sheet
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
import { loadData } from "./data.js";
import { ensureFonts, familiesFor, fontStack } from "../../shared/fonts.js";
import { drawSheet } from "./render.js";

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Territory */
/** @typedef {import("./data.js").Layout} Layout */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {import("./data.js").KeyboardData | null} */
let DATA = null;
/** @type {Territory[]} countries that have a layout */
let COUNTRIES = [];
/** @type {Territory | null} */
let chosen = null;
/** @type {Layout | null} */
let layout = null;
/** The font stack for the current layout, once its fonts are loaded. */
let font = fontStack([]);
/** Incremented per layout, so slow fonts can't draw an older choice. */
let request = 0;

/* ═══════════════════════════════════════════════════════════
   Options
   ═══════════════════════════════════════════════════════════ */

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  const auto = layout ? layout.shape : "iso";
  return {
    shape: isPressed("shapeIso") ? "iso" : isPressed("shapeAnsi") ? "ansi" : auto,
    shift: $("optShift").checked,
    altgr: $("optAltgr").checked,
    latin: $("optLatin").checked,
    bottom: $("optBottom").checked,
    key: safeColour($("keyColor").value, "#f2f0eb"),
    ink: safeColour($("inkColor").value, "#1e2228"),
    accent: safeColour($("accentColor").value, "#c0392b"),
    bg: safeColour($("bgColor").value, "#2a2e35"),
    transparent: $("optTransparent").checked,
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
    label: $("optName").checked && layout ? layout.name : "",
    font,
  };
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
  if (!c || !DATA) return;
  chosen = c;
  $("country").value = c.name;
  picker.close();
  note("");
  const ids = DATA.countries.get(c.code) || [];
  const sel = $("layout");
  sel.replaceChildren(
    ...ids.map((id, i) => {
      const l = /** @type {Layout} */ (DATA && DATA.layouts.get(id));
      return new Option(i === 0 ? `${l.name} · usual` : l.name, id); // text, never markup
    }),
  );
  sel.disabled = ids.length < 2;
  chooseLayout(ids[0]);
}

/** @param {string} id */
async function chooseLayout(id) {
  layout = (DATA && DATA.layouts.get(id)) || null;
  if (!layout) return refresh();
  const mine = ++request;
  const families = familiesFor(layout.keys);
  progress("Loading fonts", true);
  try {
    await ensureFonts(families, Object.values(layout.keys).flat().join(""));
  } finally {
    if (mine === request) progress(null);
  }
  if (mine !== request) return;
  font = fontStack(families);
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

function refresh() {
  syncUI();
  if (!layout || !DATA) {
    $("sheetWrap").hidden = true;
    $("empty").hidden = false;
    return;
  }
  try {
    drawSheet($("sheet"), currentOptions(), content());
    $("sheetWrap").hidden = false;
    $("empty").hidden = true;
    $("sources").hidden = false;
  } catch (e) {
    note("Couldn't draw the keyboard: " + cleanText(e && e.message, 80), true);
  }
}

/** What the sheet draws. */
function content() {
  const latin = DATA && layout && DATA.layouts.get(layout.latin);
  const us = /** @type {Layout} */ (latin || (DATA && DATA.layouts.get("en")));
  return { keys: layout ? layout.keys : {}, us: us.keys };
}

function syncUI() {
  const ready = !!layout;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("pngOnly").hidden = !transparent;
  $("bgColor").disabled = $("bgHex").disabled = transparent;
  $("revealTag").hidden = !$("optName").checked;
  $("capPosField").hidden = !cleanText($("capText").value, 120);
}

/**
 * @param {string} type
 * @param {string} ext
 */
async function exportSheet(type, ext) {
  if (!layout || !chosen) return;
  const opts = currentOptions();
  if (type === "image/jpeg") opts.transparent = false;
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts, content());
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The filename shouldn't give away what the picture is hiding.
    const slug = opts.label ? slugify(layout.name) : hashSlug(`${chosen.code}|${layout.id}`);
    downloadBlob(blob, `keyboard-${slug || "layout"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

$("layout").addEventListener("change", () => chooseLayout($("layout").value));

const SHAPES = ["shapeAuto", "shapeIso", "shapeAnsi"];
for (const id of SHAPES)
  $(id).addEventListener("click", () => {
    for (const other of SHAPES) $(other).setAttribute("aria-pressed", String(other === id));
    refresh();
  });

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

for (const id of ["optShift", "optAltgr", "optLatin", "optBottom", "optTransparent", "optName"])
  $(id).addEventListener("change", refresh);

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
const refreshLater = debounce(refresh, 400);
for (const id of ["customW", "customH"]) $(id).addEventListener("input", refreshLater);
$("capText").addEventListener("input", debounce(refresh, 300));

bindColour("keyColor", "keyHex", refresh);
bindColour("inkColor", "inkHex", refresh);
bindColour("accentColor", "accentHex", refresh);
bindColour("bgColor", "bgHex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

function renderSources() {
  const dl = $("sourceList");
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
    "Layouts",
    "https://github.com/unicode-org/cldr/tree/release-43/keyboards/windows",
    "Unicode CLDR 43, Windows keyboard layouts · Unicode License v3",
  );
  row(
    "CJK legends",
    "https://en.wikipedia.org/wiki/Keyboard_layout#Chinese",
    "Dubeolsik, JIS kana, Zhuyin and Cangjie: standard assignments, entered by hand",
  );
  row("Country names", "https://cldr.unicode.org/", "Unicode CLDR");
  row("Fonts", "https://fonts.google.com/noto", "Noto, via Google Fonts · SIL Open Font License");
}

async function start() {
  progress("Loading keyboards", true);
  syncUI();
  renderSources();
  try {
    const [data, territories] = await Promise.all([loadData(), loadTerritories()]);
    DATA = data;
    COUNTRIES = territories.filter((t) => data.countries.has(t.code));
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — start typing`;
    input.focus();
  } catch (e) {
    note(
      "Couldn't load the keyboards: " +
        cleanText(e && e.message, 70) +
        ". Check your connection and reload.",
      true,
    );
  } finally {
    progress(null);
  }
  // Fonts for Latin keyboards, ahead of the first pick.
  ensureFonts([], "QWERTZ").catch(() => {});
}

start();
