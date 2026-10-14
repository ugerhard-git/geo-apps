/**
 * GeoCards — country statistics as a sheet of cards.
 *
 * Modules: data.js (fetching), catalogue.js (every card on offer), cards.js
 * (assembling them), render.js (drawing), colours.js and format.js. This file
 * holds the page: state, picker, previews, API key and wiring.
 */

import { palette, PRESETS } from "./colours.js";
import { CARDS, DEFAULTS, GROUP_ORDER } from "./catalogue.js";
import {
  ensureFonts,
  renderSheet,
  renderSingle,
  SHEET_H,
  SHEET_W,
  smallestScale,
} from "./render.js";
import { buildCards } from "./cards.js";
import { cache, invalidateAtlas, rcCheckKey, resolveCountry } from "./data.js";
import { canRemember, forgetKey, getKey, saveKey } from "../../shared/keys.js";
import { loadAlpha3, loadTerritories } from "../../shared/cldr.js";
import { createCountryPicker, rankCountries } from "../../shared/country-picker.js";

function currentPalette() {
  return palette(state.cardBg, state.cardText, state.cardTransparent);
}

/* ============================================================
 10. UI
 ============================================================ */
const $ = (id) => document.getElementById(id);
const state = {
  cardBg: PRESETS.light.bg,
  cardText: PRESETS.light.text,
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

/* -- picker -- */
const available = (def) => def.needs !== "rc" || state.source === "rest";

function buildPicker() {
  const host = $("groups");
  host.innerHTML = "";
  GROUP_ORDER.forEach((g) => {
    const items = CARDS.filter((c) => c.group === g);
    if (!items.length) return;

    const sec = document.createElement("div");
    sec.className = "group";

    const head = document.createElement("header");
    const h = document.createElement("h3");
    h.textContent = g;
    const all = document.createElement("button");
    all.type = "button";
    all.textContent = "select all";
    const none = document.createElement("button");
    none.type = "button";
    none.textContent = "clear";
    head.append(h, all, none);
    sec.appendChild(head);

    const row = document.createElement("div");
    row.className = "chips";
    items.forEach((c) => {
      const usable = available(c);
      const lab = document.createElement("label");
      lab.className = "chip";
      const notes = [];
      if (!usable) notes.push("Needs a REST Countries API key");
      if (c.reveals) notes.push("Gives the country away");
      if (c.fb) notes.push("From the final Factbook edition, frozen in 2026");
      if (notes.length) lab.title = notes.join(". ");

      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.value = c.id;
      inp.checked = state.selected.includes(c.id);
      inp.disabled = !usable;
      inp.addEventListener("change", onPick);

      const sp = document.createElement("span");
      sp.appendChild(document.createTextNode(c.label));
      const mark = (cls, text) => {
        const i = document.createElement("i");
        i.className = "mark " + cls;
        if (text) i.textContent = text;
        sp.appendChild(i);
      };
      if (c.reveals) mark("dot", "");
      if (c.fb) mark("frozen", "2026");
      if (!usable) mark("key", "key");

      lab.append(inp, sp);
      row.appendChild(lab);
    });
    sec.appendChild(row);

    const setGroup = (on) => {
      items.forEach((c) => {
        if (!available(c)) return;
        const box = row.querySelector(`input[value="${c.id}"]`);
        if (box) box.checked = on;
      });
      onPick();
    };
    all.addEventListener("click", () => setGroup(true));
    none.addEventListener("click", () => setGroup(false));

    host.appendChild(sec);
  });
  updateTally();
}

/* Selection order decides sheet order: keep what is already chosen in the
 order it was chosen, then append anything newly ticked. */
function currentPicks() {
  const checked = new Set(
    [...$("groups").querySelectorAll("input[type=checkbox]")]
      .filter((b) => b.checked)
      .map((b) => b.value),
  );
  const kept = state.selected.filter((id) => checked.has(id));
  const added = CARDS.map((c) => c.id).filter((id) => checked.has(id) && !kept.includes(id));
  return [...kept, ...added];
}

function updateTally() {
  const n = state.selected.length;
  $("tally").textContent = n + (n === 1 ? " selected" : " selected");
  const small = n ? smallestScale(n) < 0.72 : false;
  $("denseNote").hidden = !small;
  if (small)
    $("denseNote").textContent =
      `At ${n} cards each one is drawn small, so source credits and list details are dropped to keep the text legible.`;
}

async function onPick() {
  const picks = currentPicks();
  if (!picks.length) {
    say("Pick at least one statistic.", true);
    state.selected = [];
    updateTally();
    return;
  }
  state.selected = picks;
  updateTally();
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
  grid.innerHTML = "";
  state.cards.forEach((card) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    const shot = document.createElement("div");
    shot.className = "shot" + (state.transparent || state.cardTransparent ? " alpha" : "");
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
    $("cardBg").value = p.bg;
    $("cardText").value = p.text;
    markPreset(b.dataset.preset);
    if (state.cards.length) paintPreviews();
  });
});

function onColour() {
  state.cardBg = $("cardBg").value;
  state.cardText = $("cardText").value;
  const match = Object.keys(PRESETS).find(
    (k) =>
      PRESETS[k].bg.toLowerCase() === state.cardBg.toLowerCase() &&
      PRESETS[k].text.toLowerCase() === state.cardText.toLowerCase(),
  );
  markPreset(match || null);
  if (state.cards.length) paintPreviews();
}
$("cardBg").addEventListener("input", onColour);
$("cardText").addEventListener("input", onColour);

$("alphaCard").addEventListener("change", (e) => {
  state.cardTransparent = e.target.checked;
  $("cardBg").disabled = e.target.checked;
  if (state.cards.length) paintPreviews();
});

$("alpha").addEventListener("change", (e) => {
  state.transparent = e.target.checked;
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
  $("toggleKey").textContent = open ? "Hide API key" : "Add an API key";
});

$("checkKey").addEventListener("click", async () => {
  const key = $("apikey").value.trim();
  if (!key) {
    keySay("Paste a key first.", true);
    return;
  }
  $("checkKey").disabled = true;
  keySay("Checking\u2026");
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
  } catch (err) {
    state.keyOk = false;
    state.apiKey = "";
    state.keyToken++;
    invalidateAtlas();
    paintSource();
    keySay(err.hint || err.message || "The key could not be checked.", true);
    console.error(err);
  } finally {
    $("checkKey").disabled = false;
  }
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

$("togglePicker").addEventListener("click", () => {
  const p = $("picker"),
    open = p.hidden;
  p.hidden = !open;
  $("togglePicker").setAttribute("aria-expanded", String(open));
  $("togglePicker").textContent = open ? "Hide statistics" : "Choose statistics";
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
  $("keypanel").hidden = false;
  $("toggleKey").setAttribute("aria-expanded", "true");
  $("toggleKey").textContent = "Hide API key";
  keySay("A saved key is loaded. Check it to switch to REST Countries.");
}
paintSource();
buildPicker();
ensureFonts();
