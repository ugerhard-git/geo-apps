/**
 * The type-ahead country search used by the sheet apps: a text input with a
 * dropdown of up to nine matches, driven by the mouse or the arrow keys.
 *
 * Expected markup (the ids are configurable):
 *
 * ```html
 * <div class="field search-wrap">
 *   <input type="text" id="country" autocomplete="off" disabled>
 *   <div class="results" id="countryResults"></div>
 * </div>
 * ```
 *
 * @module shared/country-picker
 */

import { $ } from "./dom.js";
import { bareName } from "./text.js";

/**
 * @template C
 * @typedef {object} RankOptions
 * @property {(c: C) => Array<string | undefined | null>} forms every name the
 *   item answers to (official name, alternatives, nicknames)
 * @property {(c: C) => string} [code] its ISO code, if it has one
 * @property {(c: C) => string} label the name shown, and the sort order among equals
 * @property {(s: string) => string} [normalise=bareName] how names and the
 *   query are normalised before comparing
 * @property {number} [limit=9] most matches to return
 */

/**
 * Rank items against a search query. Best first:
 *
 * 1. an exact two-letter code ("de")
 * 2. an exact name
 * 3. a name starting with the query
 * 4. a code starting with the query (one or two letters only)
 * 5. a name containing the query
 *
 * @template C
 * @param {string} query
 * @param {C[]} items
 * @param {RankOptions<C>} options
 * @returns {C[]}
 */
export function rankCountries(query, items, options) {
  const { forms, code = () => "", label, normalise = bareName, limit = 9 } = options;
  const n = normalise(query);
  if (!n) return [];
  /** @type {{ c: C, score: number }[]} */
  const scored = [];
  for (const c of items) {
    const names = forms(c)
      .filter((f) => typeof f === "string" && f)
      .map((f) => normalise(/** @type {string} */ (f)));
    const iso = (code(c) || "").toLowerCase();
    let score = -1;
    if (n.length === 2 && iso === n) score = 0;
    else if (names.includes(n)) score = 1;
    else if (names.some((f) => f.startsWith(n))) score = 2;
    else if (iso.startsWith(n) && n.length <= 2) score = 3;
    else if (names.some((f) => f.includes(n))) score = 4;
    if (score >= 0) scored.push({ c, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || label(a.c).localeCompare(label(b.c)))
    .slice(0, limit)
    .map((s) => s.c);
}

/**
 * @template C
 * @typedef {RankOptions<C> & {
 *   items: () => C[],
 *   onPick: (c: C) => void,
 *   inputId?: string,
 *   resultsId?: string,
 * }} PickerOptions
 */

/**
 * @typedef {object} CountryPicker
 * @property {() => void} close empty and hide the dropdown
 */

/**
 * Wire up a country search box.
 *
 * Picking a result (click or Enter) calls `onPick`; the app is expected to put
 * the chosen name in the input and call `picker.close()`.
 *
 * @template C
 * @param {PickerOptions<C>} options
 * @returns {CountryPicker}
 */
export function createCountryPicker(options) {
  const { items, onPick, inputId = "country", resultsId = "countryResults" } = options;
  const input = $(inputId);
  const results = $(resultsId);
  /** @type {C[]} */
  let matches = [];
  let cursor = 0;

  function render() {
    results.replaceChildren(
      ...matches.map((c, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.index = String(i);
        if (i === cursor) b.className = "on";
        const iso = options.code ? options.code(c) : "";
        if (iso) {
          const code = document.createElement("code");
          code.textContent = iso; // text, never markup
          b.append(code);
        }
        const label = document.createElement("span");
        label.textContent = options.label(c); // text, never markup
        b.append(label);
        return b;
      }),
    );
  }

  function close() {
    matches = [];
    render();
  }

  input.addEventListener("input", (/** @type {Event} */ e) => {
    matches = rankCountries(/** @type {HTMLInputElement} */ (e.target).value, items(), options);
    cursor = 0;
    render();
  });

  input.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
    if (!matches.length) return;
    if (e.key === "ArrowDown") {
      cursor = (cursor + 1) % matches.length;
      render();
      e.preventDefault();
    }
    if (e.key === "ArrowUp") {
      cursor = (cursor - 1 + matches.length) % matches.length;
      render();
      e.preventDefault();
    }
    if (e.key === "Enter") {
      onPick(matches[cursor]);
      e.preventDefault();
    }
    if (e.key === "Escape") close();
  });

  results.addEventListener("click", (/** @type {MouseEvent} */ e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("button");
    if (b && b.dataset.index) {
      const c = matches[Number(b.dataset.index)];
      if (c) onPick(c);
    }
  });

  return { close };
}
