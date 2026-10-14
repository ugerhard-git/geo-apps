/**
 * GeoCards — country statistics as a sheet of cards.
 *
 * Modules: data.js (fetching), catalogue.js (every card on offer), cards.js
 * (assembling them), render.js (drawing), colours.js and format.js. This file
 * holds the page: state, picker, previews, API key and wiring.
 */

import { hex2rgb, palette, PRESETS } from "./colours.js";
import { DEFAULTS } from "./catalogue.js";
import {
  ensureFonts,
  renderSheet,
  renderSingle,
  SHEET_H,
  SHEET_W,
  smallestScale,
} from "./render.js";
import { buildCards } from "./cards.js";
import { createStatsPicker } from "./picker.js";
import { cache, invalidateAtlas, rcCheckKey, resolveCountry } from "./data.js";
import { canRemember, forgetKey, getKey, saveKey } from "../../shared/keys.js";
import { loadAlpha3, loadTerritories } from "../../shared/cldr.js";
import { createCountryPicker, rankCountries } from "../../shared/country-picker.js";

function currentPalette() {
  return palette(state.cardBg, state.cardText, state.cardTransparent, state.sheetBg);
}

/* ============================================================
 10. UI
 ============================================================ */
const $ = (id) => document.getElementById(id);
const state = {
  cardBg: PRESETS.light.bg,
  cardText: PRESETS.light.text,
  sheetBg: PRESETS.light.sheet,
  cardTransparent: false,
  transparent: false,
  selected: [...DEFAULTS],
  cards: [],
  country: null,
  busy: false,
  source: "open",
  apiKey: "",
  keyOk: false,
  keyToken: 0,
};

/*
  The REST Countries key is kept by shared/keys.js under the service name
  "restcountries", so a key saved here is available to every app on this site
  (and keys saved by older versions of this page, as "geocards.key" or
  "meridian.key", are picked up and moved).
*/

/* -- statistics picker (see picker.js) -- */
const available = (def) => def.needs !== "rc" || state.source === "rest";

const statsPicker = createStatsPicker({
  chosen: $("chosen"),
  groups: $("groups"),
  isAvailable: available,
  onChange: onPick,
});

/** Redraw the picker, e.g. after the data source changes what is available. */
function buildPicker() {
  statsPicker.set(state.selected);
  updateTally();
}

function updateTally() {
  const n = state.selected.length;
  $("tally").textContent = n === 1 ? "1 card" : n + " cards";
  const small = n ? smallestScale(n) < 0.72 : false;
  $("denseNote").hidden = !small;
  if (small)
    $("denseNote").textContent =
      `At ${n} cards each one is drawn small, so source credits and list details are dropped to keep the text legible.`;
}

/** @param {string[]} picks the new selection, in sheet order */
async function onPick(picks) {
  state.selected = picks;
  updateTally();
  if (!picks.length) {
    say("Pick at least one statistic.", true);
    return;
  }
  if (state.country) await generate(state.country, true);
}

/* -- status -- */
function say(msg, isErr) {
  const el = $("status");
  el.textContent = msg || "";
  el.classList.toggle("err", !!isErr);
}

/* -- previews -- */
function paintPreviews() {
  const grid = $("grid");
  const pal = currentPalette();
  paintSheetPanel();
  grid.innerHTML = "";
  state.cards.forEach((card) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    const shot = document.createElement("div");
    shot.className = "shot";
    const cv = renderSingle(card, pal, state.transparent);
    cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", card.label + " card");
    shot.appendChild(cv);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Download this card";
    btn.addEventListener("click", () => saveCanvas(cv, `card-${card.id}.png`));
    cell.append(shot, btn);
    grid.appendChild(cell);
  });
  $("empty").hidden = state.cards.length > 0;
  $("count").textContent = state.cards.length
    ? `${state.cards.length} ${state.cards.length === 1 ? "card" : "cards"} ready — sheet is ${SHEET_W} × ${SHEET_H} pixels`
    : "No cards yet";
  $("dlEach").disabled = !state.cards.length;
  $("dlSheet").disabled = !state.cards.length;
  $("showText").disabled = !state.cards.length;
  if (!$("textpanel").hidden) $("statstext").value = statsText();
}

/**
 * The preview grid sits on one panel in the sheet colour, so the cards look
 * as they will on the downloaded sheet. With a transparent sheet the panel
 * shows a checkerboard instead. The per-card links take whichever of dark or
 * light text reads better on that colour.
 */
function paintSheetPanel() {
  const grid = $("grid");
  grid.classList.toggle("alpha", state.transparent);
  grid.style.backgroundColor = state.transparent ? "" : state.sheetBg;
  const [r, g, b] = hex2rgb(state.sheetBg);
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 150;
  grid.classList.toggle("on-dark", !state.transparent && !light);
}

/* -- plain text -- */
/* Tab separated, so it reads as text and pastes into a spreadsheet as columns.
 The country name stays out of it, same as the cards. */
function statsText() {
  return state.cards
    .map((c) => {
      if (c.kind === "empty") return c.label + "\tNot reported";
      const value = [c.big, c.unit].filter(Boolean).join(" ");
      return c.label + "\t" + value + (c.detail ? "\t" + c.detail : "");
    })
    .join("\n");
}

/* -- saving -- */
function saveCanvas(cv, name) {
  cv.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, "image/png");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -- main flow -- */
async function generate(country, quiet) {
  if (state.busy) return;
  state.busy = true;
  $("go").disabled = true;
  $("progress").hidden = false;
  if (!quiet) say("Fetching figures…");
  try {
    await ensureFonts();
    const cards = await buildCards(country, state.selected, state, (got, total) => {
      if (!quiet) say(`Loading country data, ${got} of ${total}\u2026`);
    });
    state.country = country;
    state.cards = cards;
    paintPreviews();
    const missing = cards.filter((c) => c.kind === "empty").length;
    say(
      missing
        ? `Cards drawn. ${missing} ${missing === 1 ? "statistic is" : "statistics are"} not reported for this country.`
        : "Cards drawn.",
    );
  } catch (err) {
    console.error(err);
    say("Could not reach the World Bank data service. Check your connection and try again.", true);
  } finally {
    state.busy = false;
    $("go").disabled = false;
    $("progress").hidden = true;
  }
}

/* -- country search --
   The same type-ahead as the other apps: CLDR names and ISO codes, picked with
   the arrow keys and Enter or a click. A pick is looked up by its ISO code.
   Text that matches nothing in the list still goes through the data set's own
   fuzzy matching, so local names and near-misses keep working. */

/** @type {Array<{code: string, name: string, alts: string[]}>} */
let COUNTRIES = [];
const pickerOptions = {
  forms: (/** @type {any} */ c) => [c.name, ...c.alts],
  code: (/** @type {any} */ c) => c.code,
  label: (/** @type {any} */ c) => c.name,
};
const picker = createCountryPicker({
  ...pickerOptions,
  items: () => COUNTRIES,
  inputId: "q",
  onPick: (c) => {
    picker.close();
    lookUp(c.code, c.name);
  },
});

Promise.all([loadTerritories(), loadAlpha3()])
  .then(([territories, alpha3]) => {
    COUNTRIES = territories.map((t) => ({
      code: t.code,
      name: t.name,
      alts: alpha3.has(t.code) ? [...t.alts, alpha3.get(t.code) || ""] : t.alts,
    }));
  })
  .catch(() => {
    /* no suggestions, but typing a name and pressing Enter still works */
  });

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("q").value.trim();
  if (!q) return;
  const best = rankCountries(q, COUNTRIES, pickerOptions)[0];
  picker.close();
  if (best) lookUp(best.code, best.name);
  else lookUp(q, "");
});

/**
 * Find a country in the reference data and draw its cards.
 *
 * @param {string} query an ISO code from the picker, or whatever was typed
 * @param {string} name the picked country's name, for messages; "" for typed text
 */
async function lookUp(query, name) {
  if (state.busy) return;
  $("go").disabled = true;
  $("progress").hidden = false;
  say(cache.atlas ? "Looking it up…" : "Loading the country data set, just this once…");
  let country = null,
    failure = null;
  try {
    country = await resolveCountry(query, state, (got, total) =>
      say(`Loading country data, ${got} of ${total}\u2026`),
    );
  } catch (err) {
    failure = err;
    console.error(err);
  }
  $("go").disabled = false;
  $("progress").hidden = true;
  if (failure) {
    if (state.source === "rest") {
      state.source = "open";
      invalidateAtlas();
      paintSource();
      buildPicker();
      keySay(failure.hint || failure.message || "The key request failed.", true);
      say(
        "REST Countries did not answer, so the open data set is back in use. See the key panel for what went wrong.",
        true,
      );
    } else {
      say(
        failure.hint ||
          "Could not load the country data set. Check your connection, then try again.",
        true,
      );
    }
    return;
  }
  if (!country) {
    say(
      name
        ? `${name} isn't in the current reference data set.`
        : "No country matches that. Try the English name or an ISO code such as DE or DEU.",
      true,
    );
    return;
  }
  $("q").value = ""; // the answer never stays on screen
  await generate(country, false);
}

/* -- controls -- */
function markPreset(name) {
  document
    .querySelectorAll(".seg button[data-preset]")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === name)));
}

document.querySelectorAll(".seg button[data-preset]").forEach((b) => {
  b.addEventListener("click", () => {
    const p = PRESETS[b.dataset.preset];
    state.cardBg = p.bg;
    state.cardText = p.text;
    state.sheetBg = p.sheet;
    $("cardBg").value = p.bg;
    $("cardText").value = p.text;
    $("sheetBg").value = p.sheet;
    markPreset(b.dataset.preset);
    if (state.cards.length) paintPreviews();
  });
});

function onColour() {
  state.cardBg = $("cardBg").value;
  state.cardText = $("cardText").value;
  state.sheetBg = $("sheetBg").value;
  const same = (/** @type {string} */ a, /** @type {string} */ b) =>
    a.toLowerCase() === b.toLowerCase();
  const match = Object.keys(PRESETS).find(
    (k) =>
      same(PRESETS[k].bg, state.cardBg) &&
      same(PRESETS[k].text, state.cardText) &&
      same(PRESETS[k].sheet, state.sheetBg),
  );
  markPreset(match || null);
  if (state.cards.length) paintPreviews();
}
$("cardBg").addEventListener("input", onColour);
$("cardText").addEventListener("input", onColour);
$("sheetBg").addEventListener("input", onColour);

$("alphaCard").addEventListener("change", (e) => {
  state.cardTransparent = e.target.checked;
  $("cardBg").disabled = e.target.checked;
  if (state.cards.length) paintPreviews();
});

$("alpha").addEventListener("change", (e) => {
  state.transparent = e.target.checked;
  $("sheetBg").disabled = e.target.checked;
  if (state.cards.length) paintPreviews();
});

/* -- plain text panel -- */
$("showText").addEventListener("click", () => {
  const p = $("textpanel"),
    open = p.hidden;
  p.hidden = !open;
  $("showText").textContent = open ? "Hide text" : "Show as text";
  if (open) {
    $("statstext").value = statsText();
    $("copystatus").textContent = "";
  }
});

$("copyText").addEventListener("click", async () => {
  const text = statsText();
  const done = (ok) => {
    $("copystatus").textContent = ok
      ? "Copied."
      : "Copying is blocked here — select the text above and copy it yourself.";
  };
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      done(true);
      return;
    }
    throw new Error("no clipboard");
  } catch (e) {
    const ta = $("statstext");
    ta.value = text;
    ta.removeAttribute("readonly");
    ta.focus();
    ta.select();
    let ok;
    try {
      ok = document.execCommand("copy");
    } catch (e2) {
      ok = false;
    }
    ta.setAttribute("readonly", "readonly");
    done(ok);
  }
});

/* -- data source + API key -- */
function paintSource() {
  document
    .querySelectorAll(".seg button[data-source]")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.source === state.source)));
  $("srcRest").disabled = !state.keyOk;
}

function keySay(msg, isErr) {
  const el = $("keystatus");
  el.textContent = msg || "";
  el.classList.toggle("err", !!isErr);
}

async function useSource(next) {
  if (next === state.source) return;
  if (next === "rest" && !state.keyOk) return;
  state.source = next;
  invalidateAtlas();
  paintSource();
  buildPicker();
  if (!state.country) {
    say("Reference data switched. Look a country up to draw cards.");
    return;
  }
  /* re-resolve the same country inside the new data set, by ISO code */
  const code = state.country.iso3 || state.country.iso2;
  let again;
  try {
    again = await resolveCountry(code, state, (g, t) =>
      say(`Loading country data, ${g} of ${t}\u2026`),
    );
  } catch (err) {
    say(err.hint || "Could not load that source.", true);
    return;
  }
  if (!again) {
    say("That country is not in this data set.", true);
    return;
  }
  await generate(again, false);
}

document.querySelectorAll(".seg button[data-source]").forEach((b) => {
  b.addEventListener("click", () => useSource(b.dataset.source));
});

$("toggleKey").addEventListener("click", () => {
  const p = $("keypanel"),
    open = p.hidden;
  p.hidden = !open;
  $("toggleKey").setAttribute("aria-expanded", String(open));
  paintKeyToggle();
});

/** The key settings start closed; the toggle says whether a key is waiting inside. */
function paintKeyToggle() {
  const open = !$("keypanel").hidden;
  const has = !!$("apikey").value.trim();
  const checking = $("checkKey").disabled;
  const status = state.keyOk
    ? " (key active)"
    : checking
      ? " (checking key\u2026)"
      : has
        ? " (key not active)"
        : "";
  $("toggleKey").textContent = open ? "Hide API key settings" : "API key settings" + status;
}

/**
 * Check a REST Countries key and, if it is accepted, switch to that data set.
 * Used by the "Check key" button and, at start-up, for a saved key.
 *
 * @param {string} key
 * @param {{auto?: boolean}} [opts] auto: started by the page, not the user
 */
async function applyKey(key, { auto = false } = {}) {
  $("checkKey").disabled = true; // also tells paintKeyToggle a check is running
  paintKeyToggle();
  keySay(auto ? "Checking the saved key\u2026" : "Checking\u2026");
  try {
    const total = await rcCheckKey(key);
    state.apiKey = key;
    state.keyOk = true;
    state.keyToken++;
    invalidateAtlas();
    keySay(`Key accepted. ${total} countries available.`);
    if ($("rememberKey").checked) saveKey("restcountries", key);
    paintSource();
    await useSource("rest");
    if (auto && !state.country) say("Your saved REST Countries key is active.");
  } catch (err) {
    state.keyOk = false;
    state.apiKey = "";
    state.keyToken++;
    invalidateAtlas();
    paintSource();
    const why = err.hint || err.message || "The key could not be checked.";
    keySay(why, true);
    if (auto)
      say("Your saved REST Countries key didn\u2019t work, so open data is in use. " + why, true);
    console.error(err);
  } finally {
    $("checkKey").disabled = false;
    paintKeyToggle();
  }
}

$("checkKey").addEventListener("click", () => {
  const key = $("apikey").value.trim();
  if (!key) {
    keySay("Paste a key first.", true);
    return;
  }
  applyKey(key);
});

$("forgetKey").addEventListener("click", async () => {
  state.apiKey = "";
  state.keyOk = false;
  state.keyToken++;
  $("apikey").value = "";
  $("rememberKey").checked = false;
  forgetKey("restcountries");
  invalidateAtlas();
  paintSource();
  keySay("Key forgotten, here and in this browser.");
  if (state.source === "rest") {
    state.source = "open";
    paintSource();
    buildPicker();
    if (state.country) {
      const code = state.country.iso3 || state.country.iso2;
      try {
        const again = await resolveCountry(code, state);
        if (again) {
          await generate(again, false);
          return;
        }
      } catch (e) {
        /* fall through to the plain notice */
      }
    }
    say("Back on the open data set.");
  }
});

$("rememberKey").addEventListener("change", (e) => {
  if (e.target.checked) {
    const key = $("apikey").value.trim();
    if (key && !saveKey("restcountries", key)) {
      e.target.checked = false;
      keySay(
        "This browser will not let the page store anything, so the key stays in memory only.",
        true,
      );
    }
  } else {
    forgetKey("restcountries");
  }
});

$("resetPick").addEventListener("click", () => {
  state.selected = [...DEFAULTS];
  buildPicker();
  if (state.country) generate(state.country, true);
});

$("dlSheet").addEventListener("click", () => {
  const cv = renderSheet(state.cards, currentPalette(), state.transparent);
  saveCanvas(cv, "geocards-sheet.png");
});

$("dlEach").addEventListener("click", async () => {
  const btn = $("dlEach");
  btn.disabled = true;
  for (const card of state.cards) {
    saveCanvas(renderSingle(card, currentPalette(), state.transparent), `card-${card.id}.png`);
    await sleep(320);
  }
  btn.disabled = false;
});

/* startup */
if (!canRemember()) $("rememberKey").disabled = true;
const saved = getKey("restcountries");
if (saved) {
  $("apikey").value = saved;
  $("rememberKey").checked = true;
}
paintSource();
paintKeyToggle();
buildPicker();
ensureFonts();
// A saved key is checked and applied straight away; the page works with open
// data in the meantime, and stays on it if the key is refused.
if (saved) applyKey(saved, { auto: true });
