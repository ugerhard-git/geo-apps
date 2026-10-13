/**
 * Small DOM helpers for the controls every sheet app shares.
 *
 * Several of these look elements up by a fixed id (`#note`, `#bar`,
 * `#loadLabel`). Those ids are part of the common page layout; see the
 * README's "Anatomy of an app" section.
 *
 * @module shared/dom
 */

import { parseHex } from "./colour.js";

/**
 * Shorthand for `document.getElementById`.
 *
 * The return type is deliberately loose (`any`) so editors don't flag every
 * `$("x").value`; the ids are checked by the smoke tests instead.
 *
 * @param {string} id
 * @returns {any}
 */
export const $ = (id) => document.getElementById(id);

/**
 * Mark one button of a two-button segmented control as pressed.
 *
 * @param {HTMLElement} on
 * @param {HTMLElement} off
 */
export function setSeg(on, off) {
  on.setAttribute("aria-pressed", "true");
  off.setAttribute("aria-pressed", "false");
}

/**
 * Whether a segmented-control button is currently pressed.
 *
 * @param {string} id
 * @returns {boolean}
 */
export const isPressed = (id) => $(id).getAttribute("aria-pressed") === "true";

/**
 * Show a message in the `#note` box under the sheet. An empty message hides it.
 *
 * @param {string} [msg]
 * @param {boolean} [isErr] style it as an error
 */
export function note(msg, isErr) {
  const n = $("note");
  n.textContent = msg || "";
  n.className = "note" + (isErr ? " err" : "");
}

/**
 * Show or hide the loading bar (`#bar`) and its label (`#loadLabel`).
 *
 * @param {string | null} label text to show, or `null` to hide the bar
 * @param {boolean} [pending] animate the bar as "busy" rather than showing it full
 */
export function progress(label, pending) {
  const bar = $("bar");
  if (label === null) {
    bar.style.display = "none";
    bar.classList.remove("pending");
    $("loadLabel").textContent = "";
    return;
  }
  bar.style.display = "block";
  bar.classList.toggle("pending", !!pending);
  if (!pending) bar.firstElementChild.style.width = "100%";
  $("loadLabel").textContent = label;
}

/**
 * Keep a native colour swatch and a hex text field in sync.
 *
 * Typing a valid colour updates the swatch immediately; an invalid one is
 * flagged with `aria-invalid` and restored when the field loses focus.
 *
 * @param {string} swatchId id of the `<input type="color">`
 * @param {string} hexId id of the hex `<input type="text">`
 * @param {() => void} onChange called whenever the colour actually changes
 */
export function bindColour(swatchId, hexId, onChange) {
  const swatch = $(swatchId);
  const hex = $(hexId);

  swatch.addEventListener("input", () => {
    hex.value = swatch.value.toLowerCase();
    hex.setAttribute("aria-invalid", "false");
    onChange();
  });

  hex.addEventListener("input", () => {
    const parsed = parseHex(hex.value);
    hex.setAttribute("aria-invalid", parsed ? "false" : "true");
    if (!parsed) return; // wait until it's a colour
    swatch.value = parsed;
    onChange();
  });

  // Tidy up on the way out: normalise what was accepted, restore what wasn't.
  hex.addEventListener("blur", () => {
    const parsed = parseHex(hex.value);
    hex.value = parsed || swatch.value.toLowerCase();
    hex.setAttribute("aria-invalid", "false");
  });
}

/**
 * Return a function that runs `fn` only once calls have paused for `ms`
 * milliseconds. Used for text fields and sliders that redraw the sheet.
 *
 * @param {() => void} fn
 * @param {number} ms
 * @returns {() => void}
 */
export function debounce(fn, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
