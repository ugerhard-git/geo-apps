/**
 * Overview page:
 *   - app of the day: a big card at the top, the same for everyone on a given
 *     day (spotlight.js), with a button to show another
 *   - marks on the cards: "New" for a few weeks after an app went live, and
 *     "Not tried yet" once this browser has opened at least one app (each
 *     app's welcome window remembers it was seen; nothing leaves the browser)
 *   - search: filters the app list by title and description as you type
 *   - kinds: the colour key doubles as a filter; pick one or more kinds to
 *     see only those apps (none picked: all), together with the search
 *   - topics: the apps come in sections; a section with nothing left to show
 *     after a search hides
 *   - layout: grid or list, remembered in this browser
 *   - saved API keys: lists every service in shared/keys.js, says whether a
 *     key is saved, and lets the visitor save, replace or forget it for all
 *     apps at once (collapsed by default)
 */

import { canRemember, forgetKey, getKey, saveKey, SERVICES } from "./shared/keys.js";
import { seenKey } from "./shared/welcome.js";
import { appOfTheDay, isNew } from "./spotlight.js";

/** @typedef {keyof typeof SERVICES} ServiceId */

const list = /** @type {HTMLElement} */ (document.getElementById("keyList"));
const blockedNote = /** @type {HTMLElement} */ (document.getElementById("keyNote"));
const storageWorks = canRemember();
blockedNote.hidden = storageWorks;

/** App titles by folder, read from the cards on this page. */
const appTitles = new Map(
  [...document.querySelectorAll(".app a")].map((a) => [
    (a.getAttribute("href") || "").replace(/^apps\/|\/$/g, ""),
    a.querySelector("h3")?.textContent || "",
  ]),
);

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 */
function make(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** @param {ServiceId} id */
function row(id) {
  const service = SERVICES[id];
  const li = make("li", "key");

  const info = make("div");
  const name = make("a", "key-name", service.name);
  name.setAttribute("href", service.url);
  name.setAttribute("rel", "noopener noreferrer");
  const usedBy = service.usedBy.map((slug) => appTitles.get(slug) || slug).join(", ");
  info.append(name, make("div", "key-meta", "Used by " + usedBy));

  const status = make("span", "key-status");

  const form = /** @type {HTMLFormElement} */ (make("form", "key-form"));
  const input = /** @type {HTMLInputElement} */ (make("input"));
  input.type = "password";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", service.name + " key");
  const save = /** @type {HTMLButtonElement} */ (make("button", "", "Save"));
  save.type = "submit";
  const forget = /** @type {HTMLButtonElement} */ (make("button", "", "Forget"));
  forget.type = "button";
  form.append(input, save, forget);

  const refresh = () => {
    const saved = getKey(id);
    status.textContent = saved ? "Saved in this browser" : "Not saved";
    status.classList.toggle("saved", !!saved);
    input.placeholder = saved
      ? "•••• " + saved.slice(-4) + " — paste a new key to replace it"
      : "Paste a key";
    forget.disabled = !saved;
    save.disabled = !storageWorks;
    input.disabled = !storageWorks;
    updateKeySummary();
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const key = input.value.trim();
    if (!key) return;
    saveKey(id, key);
    input.value = "";
    refresh();
  });
  forget.addEventListener("click", () => {
    forgetKey(id);
    refresh();
  });

  refresh();
  li.append(info, status, form);
  return li;
}

for (const id of /** @type {ServiceId[]} */ (Object.keys(SERVICES))) list.append(row(id));

/** "1 of 2 saved" next to the collapsed keys heading. */
function updateKeySummary() {
  const ids = /** @type {ServiceId[]} */ (Object.keys(SERVICES));
  const saved = ids.filter((id) => getKey(id)).length;
  /** @type {HTMLElement} */ (document.getElementById("keySummary")).textContent = saved
    ? `${saved} of ${ids.length} saved`
    : "none saved";
}
updateKeySummary();

/* ── search ──────────────────────────────────────────────── */

const search = /** @type {HTMLInputElement} */ (document.getElementById("search"));
const appList = /** @type {HTMLElement} */ (document.getElementById("apps"));
const cards = /** @type {HTMLElement[]} */ ([...appList.querySelectorAll(".app")]);
const sections = /** @type {HTMLElement[]} */ ([...appList.querySelectorAll(".topic")]);
const count = /** @type {HTMLElement} */ (document.getElementById("count"));
const noMatch = /** @type {HTMLElement} */ (document.getElementById("noMatch"));

/** @param {string} s */
const fold = (s) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** What each card is searched by: its title and description. */
const haystacks = cards.map((c) =>
  fold(
    (c.querySelector("h3")?.textContent || "") + " " + (c.querySelector("p")?.textContent || ""),
  ),
);

const kindKey = /** @type {HTMLElement} */ (document.querySelector(".kinds"));
const kindButtons = /** @type {HTMLButtonElement[]} */ ([...kindKey.querySelectorAll("button")]);
/** The kinds picked in the colour key; none means all. */
const kinds = new Set();

/**
 * Show the cards of a picked kind (any, when none is picked) whose title or
 * description contains every typed word.
 */
function applySearch() {
  const words = fold(search.value).split(/\s+/).filter(Boolean);
  let shown = 0;
  cards.forEach((c, i) => {
    const hit =
      (!kinds.size || kinds.has(c.dataset.kind || "")) &&
      words.every((w) => haystacks[i].includes(w));
    c.hidden = !hit;
    if (hit) shown++;
  });
  for (const s of sections) s.hidden = !s.querySelector(".app:not([hidden])");
  const filtered = words.length > 0 || kinds.size > 0;
  count.textContent = filtered ? `${shown} of ${cards.length} apps` : `${cards.length} apps`;
  noMatch.hidden = shown > 0;
  const kindNames = kindButtons
    .filter((b) => kinds.has(b.dataset.kind || ""))
    .map((b) => b.textContent || "");
  /** @type {HTMLElement} */ (document.getElementById("noMatchText")).textContent = words.length
    ? `No ${kindNames.length ? kindNames.join(" or ") + " " : ""}app matches “${search.value.trim()}”. Try a shorter word, or`
    : "No app of that kind —";
  kindKey.classList.toggle("filtering", kinds.size > 0);
}
search.addEventListener("input", applySearch);
for (const b of kindButtons)
  b.addEventListener("click", () => {
    const kind = b.dataset.kind || "";
    if (kinds.has(kind)) kinds.delete(kind);
    else kinds.add(kind);
    b.setAttribute("aria-pressed", String(kinds.has(kind)));
    applySearch();
  });
document.getElementById("clearSearch")?.addEventListener("click", () => {
  search.value = "";
  kinds.clear();
  for (const b of kindButtons) b.setAttribute("aria-pressed", "false");
  applySearch();
  search.focus();
});
// "/" jumps to the search box, as on many sites; Escape clears it.
document.addEventListener("keydown", (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (e.key === "/" && !typing) {
    e.preventDefault();
    search.focus();
  }
});
search.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && search.value) {
    search.value = "";
    applySearch();
  }
});
applySearch();

/* ── grid or list ────────────────────────────────────────── */

const VIEW_KEY = "geo-apps.overview.view";
/** @param {string} view "grid" | "list" */
function setView(view) {
  appList.dataset.view = view;
  for (const b of document.querySelectorAll(".view-switch button"))
    b.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (b).dataset.view === view));
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* not remembered; still works */
  }
}
for (const b of document.querySelectorAll(".view-switch button"))
  b.addEventListener("click", () => setView(/** @type {HTMLElement} */ (b).dataset.view || "grid"));
let savedView = "grid";
try {
  savedView = localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
} catch {
  /* private window or blocked storage: grid */
}
setView(savedView);

/* ── New, Not tried yet ──────────────────────────────────── */

const today = new Date();
/** @param {HTMLElement} c */
const slugOf = (c) => c.dataset.slug || "";
/** @param {HTMLElement} c */
const isExternal = (c) => c.classList.contains("external");

/**
 * Whether this browser has opened an app: its welcome window remembers.
 *
 * @param {string} slug
 */
function opened(slug) {
  try {
    return localStorage.getItem(seenKey(slug)) === "1";
  } catch {
    return false;
  }
}
// Only once a visitor has opened an app: before that, every card would say so.
const triedAny = cards.some((c) => !isExternal(c) && opened(slugOf(c)));
/** @param {HTMLElement} c */
const untried = (c) => triedAny && !isExternal(c) && !opened(slugOf(c));

// "New" sits on the picture, where it catches the eye; "Not tried yet" is
// quieter, first among the tags, since it is on most cards.
for (const c of cards) {
  if (isNew(c.dataset.added || "", today)) {
    const box = make("span", "marks");
    box.append(make("span", "new", "New"));
    c.querySelector("a")?.append(box);
  }
  if (untried(c)) c.querySelector(".tags")?.prepend(make("li", "untried", "Not tried yet"));
}

/* ── app of the day ──────────────────────────────────────── */

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const spotlight = byId("spotlight");
const spotLink = /** @type {HTMLAnchorElement} */ (byId("spotLink"));

/**
 * Show one app's card in the spotlight: its picture, title and description,
 * copied from its card as text.
 *
 * @param {HTMLElement} card
 * @param {string} label
 */
function showSpot(card, label) {
  const link = card.querySelector("a");
  if (!link) return;
  spotLink.href = link.href;
  spotLink.dataset.slug = slugOf(card);
  byId("spotLabel").textContent = label;
  byId("spotTitle").textContent = card.querySelector("h3")?.textContent || "";
  byId("spotDesc").textContent = card.querySelector("p")?.textContent || "";
  byId("spotGo").textContent = isExternal(card) ? "Open it on another site ↗" : "Open it →";
  const shot = byId("spotShot");
  shot.replaceChildren();
  const img = /** @type {HTMLImageElement | null} */ (card.querySelector(".shot img"));
  if (img) {
    const big = /** @type {HTMLImageElement} */ (make("img"));
    big.src = img.src;
    big.alt = ""; // the title next to it says what it is
    big.width = img.width;
    big.height = img.height;
    shot.append(big);
  }
  spotlight.hidden = false;
}

const daily = cards.find((c) => slugOf(c) === appOfTheDay(cards.map(slugOf), today));
if (daily) showSpot(daily, "App of the day");

/** Shown in the spotlight since the page opened, so "another" doesn't repeat. */
const shownSpots = new Set(daily ? [slugOf(daily)] : []);
byId("spotNext").addEventListener("click", () => {
  let pool = cards.filter((c) => !shownSpots.has(slugOf(c)));
  if (!pool.length) {
    // Seen them all: start again, without the one showing now.
    shownSpots.clear();
    pool = cards.filter((c) => slugOf(c) !== spotLink.dataset.slug);
  }
  // Apps this browser hasn't opened yet come first.
  const fresh = pool.filter(untried);
  if (fresh.length) pool = fresh;
  const next = pool[Math.floor(Math.random() * pool.length)];
  if (!next) return;
  shownSpots.add(slugOf(next));
  showSpot(next, "Another idea");
});
