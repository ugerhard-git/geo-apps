/**
 * The welcome window: what the app makes, how to get started, and how the
 * presets and dice work. It's kept short on purpose, so it doesn't put people
 * off: the options are on the page to try. It opens by itself on a visitor's first visit to an
 * app, and again whenever they press "How it works" under the app's title.
 *
 * Each app describes itself in its own `welcome.js` (a {@link Welcome}); the
 * getting-started steps and the presets section are written here, once.
 *
 * "Seen" is remembered per app in the browser's `localStorage`, under
 * `geo-apps.welcome.<app>`. Storage can be blocked (private windows, strict
 * settings); then the window simply opens on every visit.
 *
 * Everything is built with DOM calls and `textContent`.
 *
 * @module shared/welcome
 */

import { $ } from "./dom.js";

/**
 * @typedef {object} Welcome
 * @property {string} intro what the app makes, and why it makes a good clue
 * @property {string[]} [steps] getting started, if the usual three steps
 *   (pick a country, adjust, download) don't fit the app
 * @property {string} [presets] the presets paragraph, for an app whose
 *   presets work differently
 */

/** The storage key that marks the welcome as seen for one app. */
export const seenKey = (/** @type {string} */ app) => `geo-apps.welcome.${app}`;

/** The usual way through an app. */
const STEPS = [
  "Look at the example that's already drawn, or pick a country in the search box.",
  "Change the options. The sheet updates as you go.",
  "Download the sheet as a picture when you're happy with it.",
];

/**
 * The presets paragraph, with the dice buttons' own labels.
 *
 * @param {string} country label of the "Random country" button
 * @param {string} look label of the "Random look" button
 */
const presetsText = (country, look) =>
  "The app opens with an example. “Start from” has more, and looks that change only the colours. " +
  `“${country}” and “${look}” try something new. ` +
  "Change something yourself and the menu shows “Custom”.";

/**
 * Whether the welcome was already shown for this app. Blocked storage counts
 * as "not seen".
 *
 * @param {string} app
 */
function wasSeen(app) {
  try {
    return window.localStorage.getItem(seenKey(app)) === "1";
  } catch {
    return false;
  }
}

/** @param {string} app */
function markSeen(app) {
  try {
    window.localStorage.setItem(seenKey(app), "1");
  } catch {
    /* nothing to remember it in: it opens again next time */
  }
}

/**
 * @param {string} tag
 * @param {string} [text]
 * @param {string} [cls]
 */
function make(tag, text, cls) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

/**
 * Build the welcome window and the "How it works" button, and open the
 * window if this is the visitor's first visit to the app.
 *
 * @param {string} app the app's folder name
 * @param {Welcome} welcome
 * @returns {{open: () => void}}
 */
export function setupWelcome(app, welcome) {
  const title = document.querySelector("h1")?.textContent?.trim() || document.title;

  const dialog = /** @type {HTMLDialogElement} */ (make("dialog", "", "welcome"));
  dialog.setAttribute("aria-labelledby", "welcomeTitle");

  const close = make("button", "×", "welcome-x");
  close.type = "button";
  close.setAttribute("aria-label", "Close");

  const heading = make("h2", `Welcome to ${title}`);
  heading.id = "welcomeTitle";

  const steps = make("ol");
  for (const s of welcome.steps || STEPS) steps.append(make("li", s));

  const rndCountry = $("rndCountry")?.textContent?.trim() || "Random country";
  const rndLook = $("rndLook")?.textContent?.trim() || "Random look";

  // The text takes the focus when the window opens: the arrow keys then
  // scroll it, and no button looks pressed before the visitor has read it.
  const body = make("div", "", "welcome-body");
  body.tabIndex = -1;
  body.autofocus = true;
  body.append(
    heading,
    make("p", welcome.intro, "welcome-intro"),
    make("h3", "Getting started"),
    steps,
    make("h3", "Presets and dice"),
    make("p", welcome.presets || presetsText(rndCountry, rndLook)),
  );

  const start = make("button", "Start", "welcome-start");
  start.type = "button";
  const foot = make("div", "", "welcome-foot");
  foot.append(start, make("span", "You can open this again with “How it works” under the title."));

  dialog.append(close, body, foot);
  document.body.append(dialog);

  close.addEventListener("click", () => dialog.close());
  start.addEventListener("click", () => dialog.close());
  // A click on the dimmed backdrop (the dialog element itself) closes it too.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  function open() {
    if (dialog.open) return;
    body.scrollTop = 0;
    dialog.showModal();
    // Seen as soon as it's shown, so a reload doesn't bring it back.
    markSeen(app);
  }

  // "How it works", right under the app's title.
  const h1 = document.querySelector("h1");
  if (h1) {
    const help = make("button", "How it works", "welcome-help");
    help.type = "button";
    help.addEventListener("click", open);
    h1.after(help);
  }

  if (!wasSeen(app)) open();
  return { open };
}
