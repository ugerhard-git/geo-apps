/**
 * Baby names — a country's most popular baby names, girls and boys, with
 * nothing to say where they're from.
 *
 * Flow: the names (data/names.json, refreshed monthly from Wikipedia) and
 * CLDR's country names load → pick a country; its best lists are chosen
 * (newborns before whole-population lists, newest first), others are in the
 * menus → fonts for any non-Latin spellings load → the sheet is drawn
 * (render.js), and the lists are offered as plain text to copy.
 *
 *   data.js    reading and checking the data; describing a list; plain text
 *   render.js  drawing the sheet
 */

import { addBackLink } from "../../shared/back-link.js";
import { loadTerritories } from "../../shared/cldr.js";
import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, note, progress, setSeg } from "../../shared/dom.js";
import { ensureFonts, familiesForText, fontStack } from "../../shared/fonts.js";
import { ALIASES } from "../../shared/map-countries.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { cleanText, slugify } from "../../shared/text.js";
import { own } from "../../shared/util.js";
import { loadData, optionLabel, plainText, warningOf } from "./data.js";
import { drawSheet } from "./render.js";

addBackLink();

/** @typedef {import("../../shared/cldr.js").Territory} Territory */
/** @typedef {import("./data.js").NameList} NameList */

/** @type {import("./data.js").NamesData | null} */
let DATA = null;
/** @type {Territory[]} countries with at least one list */
let COUNTRIES = [];
/** @type {Territory | null} */
let chosen = null;
let font = fontStack([]);
/** Incremented per pick, so slow fonts can't draw an older choice. */
let request = 0;

/* ═══════════════════════════════════════════════════════════
   What is shown
   ═══════════════════════════════════════════════════════════ */

/** The chosen country's lists, if any. */
const listsOf = () => (DATA && chosen && DATA.countries.get(chosen.code)) || null;

/**
 * The list picked in a menu.
 *
 * @param {"girls" | "boys"} sex
 * @returns {NameList | null}
 */
function picked(sex) {
  const lists = listsOf();
  if (!lists) return null;
  const i = parseInt($(sex === "girls" ? "girlsList" : "boysList").value, 10) || 0;
  return lists[sex][i] || lists[sex][0] || null;
}

/** The columns on the sheet, in order. */
function columns() {
  /** @type {import("./render.js").Column[]} */
  const out = [];
  const girls = picked("girls");
  const boys = picked("boys");
  if (girls && !isPressed("showBoys")) out.push({ title: "Girls", list: girls });
  if (boys && !isPressed("showGirls")) out.push({ title: "Boys", list: boys });
  return out;
}

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    script: isPressed("scriptNative") ? "native" : isPressed("scriptBoth") ? "both" : "latin",
    count: isPressed("top5") ? 5 : 10,
    ranks: $("optRanks").checked,
    ink: safeColour($("inkColor").value, "#eef0f4"),
    accent: safeColour($("accentColor").value, "#f29db0"),
    bg: safeColour($("bgColor").value, "#171a21"),
    transparent: $("optTransparent").checked,
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
    label: $("optName").checked && chosen ? chosen.name : "",
    sourceLine: $("optSource").checked,
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
async function pickCountry(c) {
  if (!c || !DATA) return;
  chosen = c;
  $("country").value = c.name;
  picker.close();
  note("");
  const lists = listsOf();
  for (const sex of /** @type {const} */ (["girls", "boys"])) {
    const sel = $(sex === "girls" ? "girlsList" : "boysList");
    const all = lists ? lists[sex] : [];
    sel.replaceChildren(
      ...(all.length
        ? all.map((l, i) => new Option(optionLabel(l), String(i))) // text, never markup
        : [new Option("none on Wikipedia", "0")]),
    );
    sel.disabled = all.length < 2;
  }
  // Fonts for whatever scripts the names come in.
  const mine = ++request;
  const text = lists
    ? [...lists.girls, ...lists.boys]
        .flatMap((l) => l.entries.flatMap((e) => e.names.map((n) => n.s + n.n)))
        .join("")
    : "";
  const families = familiesForText(text);
  if (families.length) progress("Loading fonts", true);
  try {
    await ensureFonts(families, text);
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
  const cols = columns();
  if (!chosen || !cols.length || !DATA) {
    $("sheetWrap").hidden = true;
    $("textCard").hidden = true;
    $("empty").hidden = false;
    if (chosen && !cols.length) note("Wikipedia has no list of that kind for this country.");
    return;
  }
  try {
    drawSheet($("sheet"), currentOptions(), { columns: cols, licence: DATA.source.licence });
    $("sheetWrap").hidden = false;
    $("empty").hidden = true;
  } catch (e) {
    note("Couldn't draw the sheet: " + cleanText(e && e.message, 80), true);
  }
  const warnings = cols
    .map((c) => {
      const w = warningOf(c.list);
      return w ? `${c.title}: ${w}.` : "";
    })
    .filter(Boolean);
  note(warnings.length ? "⚠ " + warnings.join(" ") : "");
  /** @type {HTMLTextAreaElement} */ ($("plain")).value = plainText(
    chosen.name,
    cols,
    DATA.source,
    currentOptions().count,
  );
  $("textCard").hidden = false;
  renderSources(cols);
}

function syncUI() {
  const ready = !!(chosen && columns().length);
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("pngOnly").hidden = !transparent;
  $("bgColor").disabled = $("bgHex").disabled = transparent;
  $("revealTag").hidden = !$("optName").checked;
  $("capPosField").hidden = !cleanText($("capText").value, 120);
  // The spelling choice only matters when some name has a native spelling.
  const native = columns().some((c) => c.list.entries.some((e) => e.names.some((n) => n.s)));
  for (const id of ["scriptNative", "scriptBoth"])
    /** @type {HTMLButtonElement} */ ($(id)).disabled = !native;
  $("scriptHint").textContent = native
    ? "Where Wikipedia gives a name in its own script too (Cyrillic, kana…)."
    : "These names are only given in Latin letters.";
}

/**
 * @param {string} type
 * @param {string} ext
 */
async function exportSheet(type, ext) {
  const cols = columns();
  if (!chosen || !cols.length || !DATA) return;
  const opts = currentOptions();
  if (type === "image/jpeg") opts.transparent = false;
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts, { columns: cols, licence: DATA.source.licence });
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // The filename shouldn't give away what the picture is hiding.
    const slug = opts.label ? slugify(chosen.name) : hashSlug(`${chosen.code}|names`);
    downloadBlob(blob, `names-${slug || "sheet"}.${ext}`);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  }
}

/* ═══════════════════════════════════════════════════════════
   Sources
   ═══════════════════════════════════════════════════════════ */

/** @param {import("./render.js").Column[]} cols */
function renderSources(cols) {
  if (!DATA) return;
  const dl = $("sourceList");
  dl.replaceChildren();
  /**
   * @param {string} term
   * @param {string} href "" for plain text
   * @param {string} label
   */
  const row = (term, href, label) => {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    if (href && /^https?:\/\//.test(href)) {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = label; // text, never markup
      dd.append(a);
    } else dd.textContent = label;
    dl.append(dt, dd);
  };
  const s = DATA.source;
  row(
    "Lists",
    s.revid ? `${s.url}?oldid=${s.revid}` : s.url,
    `Wikipedia, “${s.title}”${s.revid ? `, revision ${s.revid}` : ""} · ${s.licence}`,
  );
  for (const c of cols)
    row(
      `${c.title} — cited`,
      c.list.source ? c.list.source.url : "",
      c.list.source ? c.list.source.title : "No source cited on Wikipedia",
    );
  row("Country names", "https://cldr.unicode.org/", "Unicode CLDR");
  $("sources").hidden = false;
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

for (const id of ["girlsList", "boysList"]) $(id).addEventListener("change", refresh);

/** @param {string[]} ids buttons of one group */
function group(ids) {
  for (const id of ids)
    $(id).addEventListener("click", () => {
      if (/** @type {HTMLButtonElement} */ ($(id)).disabled) return;
      for (const other of ids) $(other).setAttribute("aria-pressed", String(other === id));
      refresh();
    });
}
group(["showBoth", "showGirls", "showBoys"]);
group(["top5", "top10"]);
group(["scriptLatin", "scriptNative", "scriptBoth"]);

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

for (const id of ["optRanks", "optTransparent", "optName", "optSource"])
  $(id).addEventListener("change", refresh);

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
const refreshLater = debounce(refresh, 400);
for (const id of ["customW", "customH"]) $(id).addEventListener("input", refreshLater);
$("capText").addEventListener("input", debounce(refresh, 300));

bindColour("inkColor", "inkHex", refresh);
bindColour("accentColor", "accentHex", refresh);
bindColour("bgColor", "bgHex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

$("copyText").addEventListener("click", async () => {
  const box = /** @type {HTMLTextAreaElement} */ ($("plain"));
  const button = $("copyText");
  try {
    await navigator.clipboard.writeText(box.value);
    button.textContent = "Copied";
  } catch {
    // No clipboard access (an old browser, or a blocked permission): select
    // the text so a keyboard shortcut copies it.
    box.focus();
    box.select();
    button.textContent = "Selected — press Ctrl+C";
  }
  setTimeout(() => (button.textContent = "Copy as text"), 2000);
});
$("dlText").addEventListener("click", () => {
  if (!chosen) return;
  const text = /** @type {HTMLTextAreaElement} */ ($("plain")).value;
  downloadBlob(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
    `baby-names-${slugify(chosen.name) || "country"}.txt`,
  );
});

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

async function start() {
  progress("Loading names", true);
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
      "Couldn't load the names: " +
        cleanText(e && e.message, 70) +
        ". Check your connection and reload.",
      true,
    );
  } finally {
    progress(null);
  }
  ensureFonts([], "Emma Noah").catch(() => {});
}

start();
