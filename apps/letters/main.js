/**
 * Letter frequencies — how often a country's language uses each letter,
 * with nothing to say which language it is.
 *
 * Flow: the letter data (data/letters.json, from FineFreq) and CLDR's
 * country names load → pick a country, and its largest Latin-script
 * language is drawn (the others are in the Language list) → export.
 *
 *   data.js    reading and checking the data, choosing the bars
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
import { barsFor, loadData } from "./data.js";
import { drawSheet } from "./render.js";

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Territory */
/** @typedef {import("./data.js").Language} Language */

const CREDIT = "Letter counts: FineFreq (Xu 2025), CC BY 4.0";

/** @type {import("./data.js").LetterData | null} */
let DATA = null;
/** @type {Territory[]} countries with a Latin-script language */
let COUNTRIES = [];
/** @type {Territory | null} */
let chosen = null;
/** @type {Language | null} */
let lang = null;

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    bar: safeColour($("barColor").value, "#8fb8ff"),
    accent: safeColour($("accentColor").value, "#f2b84b"),
    highlight: $("optHighlight").checked,
    compareColour: safeColour($("cmpColor").value, "#8a8f98"),
    ink: safeColour($("inkColor").value, "#e9ecf2"),
    bg: safeColour($("bgColor").value, "#171a21"),
    transparent: $("optTransparent").checked,
    values: $("optValues").checked,
    upper: $("optUpper").checked,
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
    label: $("optName").checked && lang ? lang.name : "",
    credit: $("optCredit").checked ? CREDIT : "",
  };
}

/** The bars for the current language and options. */
function bars() {
  if (!lang) return [];
  const min = parseFloat($("minShare").value);
  const english = compareOn() ? (DATA && DATA.languages.get("en")) || null : null;
  return barsFor(
    lang,
    {
      order: isPressed("orderAbc") ? "alphabet" : "frequency",
      basicOnly: isPressed("lettersBasic"),
      minPercent: Number.isFinite(min) ? min : 0.02,
    },
    english,
  );
}

/** Comparing with English, which makes no sense for English itself. */
function compareOn() {
  return $("optCompare").checked && !!lang && lang.code !== "en";
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
  const codes = DATA.countries.get(c.code) || [];
  const sel = $("lang");
  sel.replaceChildren(
    ...codes.map((code) => {
      const l = /** @type {Language} */ (DATA && DATA.languages.get(code));
      return new Option(l.name, code); // text, never markup
    }),
  );
  sel.disabled = codes.length < 2;
  lang = DATA.languages.get(codes[0]) || null;
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

function refresh() {
  syncUI();
  if (!lang) {
    $("sheetWrap").hidden = true;
    $("empty").hidden = false;
    return;
  }
  try {
    drawSheet($("sheet"), currentOptions(), bars());
    $("sheetWrap").hidden = false;
    $("empty").hidden = true;
    renderSources();
  } catch (e) {
    note("Couldn't draw the chart: " + cleanText(e && e.message, 80), true);
  }
}

function syncUI() {
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !lang;
  $("dlJpg").disabled = !lang || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("pngOnly").hidden = !transparent;
  $("bgColor").disabled = $("bgHex").disabled = transparent;
  $("revealTag").hidden = !$("optName").checked;
  $("capPosField").hidden = !cleanText($("capText").value, 120);
  $("minShare").disabled = isPressed("lettersBasic");
  const isEnglish = !!lang && lang.code === "en";
  $("optCompare").disabled = isEnglish;
  $("compareHint").textContent = isEnglish
    ? "This is English already."
    : "An English bar beside each letter English has too.";
  $("compareField").hidden = !compareOn();
}

/**
 * @param {string} type
 * @param {string} ext
 */
async function exportSheet(type, ext) {
  if (!lang || !chosen) return;
  const opts = currentOptions();
  if (type === "image/jpeg") opts.transparent = false;
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts, bars());
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The filename shouldn't give away what the picture is hiding.
    const slug = opts.label ? slugify(lang.name) : hashSlug(`${chosen.code}|${lang.code}`);
    downloadBlob(blob, `letters-${slug || "chart"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
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
    "Letter counts",
    "https://github.com/Bin-2/FineFreq",
    "FineFreq — B. Xu, “A Multilingual Character Frequency Dataset from Web-Scale Text” (2025) · CC BY 4.0",
  );
  row(
    "Text",
    "https://huggingface.co/datasets/HuggingFaceFW/fineweb-2",
    "FineWeb and FineWeb2, from Common Crawl 2013–2025",
  );
  row("Languages, countries", "https://cldr.unicode.org/", "Unicode CLDR");
  const n = lang ? lang.letters : 0;
  const size =
    n >= 1e12
      ? `${(n / 1e12).toFixed(1)} trillion`
      : n >= 1e9
        ? `${(n / 1e9).toFixed(1)} billion`
        : n >= 1e6
          ? `${Math.round(n / 1e6)} million`
          : n.toLocaleString("en");
  $("caveat").textContent =
    (lang ? `${lang.name}: ${size} letters of web text. ` : "") +
    "Shares are of all letters, capitals folded into small letters. Web text mixes in foreign names " +
    "and words, so the rarest letters beyond a–z are left out by default.";
  $("sources").hidden = false;
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

$("lang").addEventListener("change", () => {
  lang = (DATA && DATA.languages.get($("lang").value)) || null;
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
seg("orderFreq", "orderAbc");
seg("orderAbc", "orderFreq");
seg("lettersAll", "lettersBasic");
seg("lettersBasic", "lettersAll");
seg("capTop", "capBottom");
seg("capBottom", "capTop");

for (const id of [
  "optHighlight",
  "optValues",
  "optCompare",
  "optUpper",
  "optTransparent",
  "optName",
  "optCredit",
  "minShare",
])
  $(id).addEventListener("change", refresh);

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
const refreshLater = debounce(refresh, 400);
for (const id of ["customW", "customH"]) $(id).addEventListener("input", refreshLater);
$("capText").addEventListener("input", debounce(refresh, 300));

bindColour("barColor", "barHex", refresh);
bindColour("accentColor", "accentHex", refresh);
bindColour("cmpColor", "cmpHex", refresh);
bindColour("inkColor", "inkHex", refresh);
bindColour("bgColor", "bgHex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

async function start() {
  progress("Loading letters", true);
  syncUI();
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
      "Couldn't load the letters: " +
        cleanText(e && e.message, 70) +
        ". Check your connection and reload.",
      true,
    );
  } finally {
    progress(null);
  }
  // The canvas silently falls back if the font isn't ready.
  if (document.fonts && document.fonts.load)
    await Promise.all(
      [400, 500, 600].map((w) => document.fonts.load(`${w} 40px "Noto Sans"`).catch(() => {})),
    );
  if (lang) refresh();
}

start();
