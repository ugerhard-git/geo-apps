/**
 * Overview page — the "Saved API keys" panel. Lists every service in
 * shared/keys.js, says whether a key is saved, and lets the visitor save,
 * replace or forget it for all apps at once.
 */

import { canRemember, forgetKey, getKey, saveKey, SERVICES } from "./shared/keys.js";

/** @typedef {keyof typeof SERVICES} ServiceId */

const list = /** @type {HTMLElement} */ (document.getElementById("keyList"));
const blockedNote = /** @type {HTMLElement} */ (document.getElementById("keyNote"));
const storageWorks = canRemember();
blockedNote.hidden = storageWorks;

/** App titles by folder, read from the cards on this page. */
const appTitles = new Map(
  [...document.querySelectorAll(".app a")].map((a) => [
    (a.getAttribute("href") || "").replace(/^apps\/|\/$/g, ""),
    a.querySelector("h2")?.textContent || "",
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
