/**
 * Presets: starting points for an app's sheet, and two dice for ideas.
 *
 * A preset is either
 *   - an example: a country, a look and the app's own options, chosen to show
 *     what the app can do (the first one is drawn when the app opens), or
 *   - a look (shared/looks.js): colours only, keeping the country and options.
 *
 * "Random country" picks another country, keeping everything else; "Random
 * look" picks another look, keeping the country. Neither touches text the
 * user typed (caption, note).
 *
 * The module works on the page's own controls: it sets a control's value and
 * fires the same events a person would, so the app's usual handlers do the
 * rest. Before an example is applied, every option goes back to how the page
 * started, so examples don't inherit each other's settings.
 *
 * Each app supplies a {@link PresetApp}: its examples, how a look maps onto
 * its colour controls, which countries the dice may pick, and how to pick
 * one. The page needs the markup in the README's "Presets" section.
 *
 * @module shared/presets
 */

import { $ } from "./dom.js";
import { LOOKS } from "./looks.js";

/**
 * @typedef {import("./looks.js").Look} Look
 */

/**
 * What a preset sets on the page.
 *
 * @typedef {object} Controls
 * @property {Record<string, string | number | boolean>} [set] control id →
 *   value: a boolean for a tick box, otherwise the value as typed or chosen
 * @property {string[]} [press] ids of segmented-control buttons to press
 */

/**
 * @typedef {Controls & {
 *   id: string,
 *   name: string,
 *   look: string,
 *   country?: string,
 *   extra?: any,
 * }} Example an example: a look id, a country (ISO alpha-2; left out by an
 *   app that shows several, which then sets them in `extra`), the options it
 *   sets, and `extra`, handed to the app's `afterCountry` once the country is
 *   loaded (for options that only exist then)
 */

/**
 * @typedef {object} PresetApp
 * @property {Example[]} examples the first is drawn when the app opens
 * @property {(look: Look) => Controls} lookToControls the app's colour
 *   controls for a look
 * @property {() => string[]} countries the countries "Random country" may
 *   pick, as ISO codes: ones the app has enough data for
 * @property {(code: string) => void | Promise<void>} pickCountry show this
 *   country, as if it had been chosen in the search box
 * @property {(extra: any) => void | Promise<void>} [afterCountry] apply an
 *   example's `extra`, after its country has loaded
 * @property {() => string | null} [currentCountry] the country shown, so the
 *   dice don't pick it again
 * @property {Look[]} [looks] the app's own looks, for an app whose look isn't
 *   a colour scheme (satellite layers, say); the shared ones by default
 * @property {string} [looksLabel] the menu heading for the looks
 */

/**
 * Places "Random country" never picks, whatever the app: uninhabited or with
 * only a few thousand people, so most apps have little or nothing to show
 * (Antarctica, Bouvet Island, the U.S. Outlying Islands, Pitcairn…).
 */
export const SKIP_RANDOM = new Set(
  "AC AQ BL BV CC CP CX DG EA GS HM IC IO MF NF NU PM PN SH SJ TA TF TK UM VA WF".split(" "),
);

/** Controls that aren't settings: the preset menu itself, buttons, text. */
const NOT_SETTINGS = new Set(["preset", "rndCountry", "rndLook"]);

/**
 * Whether a control holds a setting a preset may reset. Typed text (the
 * country search, captions, notes, hex fields) is left alone.
 *
 * @param {Element} el
 */
function isSetting(el) {
  if (!el.id || NOT_SETTINGS.has(el.id)) return false;
  if (el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement)
    return ["checkbox", "radio", "color", "range", "number"].includes(el.type);
  return el instanceof HTMLButtonElement && el.hasAttribute("aria-pressed");
}

/**
 * Snapshot of every setting in the sidebar, to go back to before an example.
 *
 * @param {HTMLElement} rail
 * @returns {Required<Controls>}
 */
function snapshot(rail) {
  /** @type {Required<Controls>} */
  const s = { set: {}, press: [] };
  for (const el of rail.querySelectorAll("input, select, button")) {
    if (!isSetting(el)) continue;
    if (el instanceof HTMLButtonElement) {
      if (el.getAttribute("aria-pressed") === "true") s.press.push(el.id);
    } else if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      s.set[el.id] = el.checked;
    } else s.set[el.id] = /** @type {HTMLInputElement | HTMLSelectElement} */ (el).value;
  }
  return s;
}

/**
 * Set controls the way a person would, so the app's own handlers run.
 * Unknown ids are skipped with a warning (the unit tests catch them first).
 *
 * @param {Controls} c
 */
export function applyControls(c) {
  // Buttons first: a mode can change what a menu offers (day or night layers).
  for (const id of c.press || []) {
    const el = $(id);
    if (!el) console.warn(`preset: no control #${id}`);
    else if (el.getAttribute("aria-pressed") !== "true") el.click();
  }
  for (const [id, value] of Object.entries(c.set || {})) {
    const el = $(id);
    if (!el) {
      console.warn(`preset: no control #${id}`);
      continue;
    }
    if (el.type === "checkbox" || el.type === "radio") {
      if (el.checked === Boolean(value)) continue;
      el.checked = Boolean(value);
    } else {
      if (el.value === String(value)) continue;
      el.value = String(value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/**
 * A random item other than `not`, if there is one.
 *
 * @template T
 * @param {T[]} items
 * @param {T | null | undefined} not
 * @param {() => number} [random]
 * @returns {T | undefined}
 */
export function pickOther(items, not, random = Math.random) {
  const pool = items.length > 1 ? items.filter((x) => x !== not) : items;
  return pool[Math.floor(random() * pool.length)];
}

/**
 * Take up to `n` items, spread across their groups: one from each group in
 * turn, in list order, so a sheet of road signs shows several kinds of sign
 * rather than six of the first kind.
 *
 * @template T
 * @param {T[]} items in order of preference
 * @param {number} n
 * @param {(item: T) => string} [groupOf] no grouping: the first `n`
 * @returns {T[]}
 */
export function pickSpread(items, n, groupOf) {
  if (!groupOf) return items.slice(0, n);
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const it of items) {
    const g = groupOf(it);
    if (!groups.has(g)) groups.set(g, []);
    /** @type {T[]} */ (groups.get(g)).push(it);
  }
  /** @type {T[]} */
  const out = [];
  for (let round = 0; out.length < n; round++) {
    let any = false;
    for (const list of groups.values()) {
      if (round < list.length && out.length < n) {
        out.push(list[round]);
        any = true;
      }
    }
    if (!any) break;
  }
  return out;
}

/**
 * Wire up the preset menu and the two dice. Call `start()` once the app can
 * pick countries; it draws the first example.
 *
 * @param {PresetApp} app
 * @returns {{start: () => Promise<void>}}
 */
export function setupPresets(app) {
  const menu = /** @type {HTMLSelectElement} */ ($("preset"));
  const rail = /** @type {HTMLElement} */ (menu.closest(".rail") || document.body);
  const baseline = snapshot(rail);
  /** The look in use, and what the menu shows when nothing was changed by hand. */
  const looks = app.looks || LOOKS;
  /** @param {string} id */
  const findLook = (id) => looks.find((l) => l.id === id);
  let lookId = looks[0].id;
  let busy = false;

  // The menu: examples, then looks, then a "custom" line for hand changes.
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.hidden = true;
  /**
   * @param {string} label
   * @param {Array<[string, string]>} items value, text
   */
  const group = (label, items) => {
    const g = document.createElement("optgroup");
    g.label = label;
    for (const [value, text] of items) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = text;
      g.append(o);
    }
    return g;
  };
  menu.replaceChildren(
    group(
      "Examples",
      app.examples.map((e) => [`ex:${e.id}`, e.name]),
    ),
    group(
      app.looksLabel || "Looks (keep the country)",
      looks.map((l) => [`look:${l.id}`, l.name]),
    ),
    custom,
  );

  /** @param {string} value "ex:<id>" or "look:<id>" */
  function show(value) {
    custom.hidden = true;
    menu.value = value;
  }

  // A setting changed by hand: the sheet no longer matches the preset.
  /** @param {Event} e */
  function handChanged(e) {
    if (!e.isTrusted || busy) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    const control = el.closest("input, select, button") || el;
    // A hex field counts too: typing a colour is changing a setting.
    const setting = isSetting(control) || /Hex$/.test(control.id);
    if (!setting || control.closest(".rail") !== rail) return;
    const text = menu.selectedOptions[0]?.textContent || "";
    if (menu.value !== "custom") {
      custom.textContent = `Custom (based on ${text})`;
      custom.hidden = false;
      menu.value = "custom";
    }
  }
  rail.addEventListener("change", handChanged);
  rail.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest("button[aria-pressed]") : null;
    if (b) handChanged(e);
  });

  /** @param {Look} look */
  function applyLook(look) {
    applyControls(app.lookToControls(look));
    lookId = look.id;
  }

  /** @param {Example} ex */
  async function applyExample(ex) {
    busy = true;
    try {
      applyControls(baseline);
      const look = findLook(ex.look) || looks[0];
      applyLook(look);
      applyControls(ex);
      show(`ex:${ex.id}`);
      if (ex.country) await app.pickCountry(ex.country);
      if (ex.extra !== undefined && app.afterCountry) await app.afterCountry(ex.extra);
    } finally {
      busy = false;
    }
  }

  menu.addEventListener("change", () => {
    const [kind, id] = menu.value.split(":");
    if (kind === "ex") {
      const ex = app.examples.find((e) => e.id === id);
      if (ex) applyExample(ex);
    } else if (kind === "look") {
      const look = findLook(id);
      if (!look) return;
      busy = true;
      try {
        applyLook(look);
      } finally {
        busy = false;
      }
      show(`look:${id}`);
    }
  });

  $("rndCountry").addEventListener("click", async () => {
    const pool = app.countries().filter((c) => !SKIP_RANDOM.has(c));
    const code = pickOther(pool, app.currentCountry?.() ?? null);
    if (!code) return;
    busy = true;
    try {
      await app.pickCountry(code);
    } finally {
      busy = false;
    }
    // Same look, another country: the menu names the look, unless the
    // settings had been changed by hand.
    if (menu.value !== "custom") show(`look:${lookId}`);
  });

  $("rndLook").addEventListener("click", () => {
    const look = pickOther(looks, findLook(lookId));
    if (!look) return;
    busy = true;
    try {
      applyLook(look);
    } finally {
      busy = false;
    }
    show(`look:${look.id}`);
  });

  return {
    async start() {
      menu.disabled = false;
      $("rndCountry").disabled = false;
      $("rndLook").disabled = false;
      // A failed example leaves the app as it was: empty, ready for a pick.
      if (app.examples[0])
        await applyExample(app.examples[0]).catch((e) => console.warn("preset:", e));
    },
  };
}
