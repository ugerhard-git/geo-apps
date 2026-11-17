/**
 * Picture Sheet — the visitor's own pictures on a quiz sheet.
 *
 * Flow: drop, paste or choose pictures → each is checked and kept as a
 * smaller copy (pictures.js), in the browser only → click thumbnails to put
 * them on the sheet, label them, move them → the sheet is drawn (render.js)
 * → export.
 *
 * There is no country and nothing is fetched: the page's security policy
 * forbids every connection. Reloading the page clears the pictures.
 *
 *   config.js    limits on files, pictures and text
 *   files.js     what a file is and how large, from its bytes (pure)
 *   pictures.js  reading and keeping the pictures
 *   render.js    drawing the sheet
 *   welcome.js   the text of the welcome window
 */

import { addBackLink } from "../../shared/back-link.js";
import { safeColour } from "../../shared/colour.js";
import {
  $,
  bindColour,
  bindScale,
  debounce,
  isPressed,
  loadFontFamilies,
  note,
  progress,
  scaleOf,
  setSeg,
} from "../../shared/dom.js";
import { LOOKS } from "../../shared/looks.js";
import { pickOther } from "../../shared/presets.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { cleanText } from "../../shared/text.js";
import { setupWelcome } from "../../shared/welcome.js";
import { MAX_CREDIT, MAX_LABEL, MAX_ON_SHEET, MAX_PICTURES } from "./config.js";
import { sheetLabel } from "./files.js";
import { createDecodedCache, readPicture } from "./pictures.js";
import { drawSheet } from "./render.js";
import { WELCOME } from "./welcome.js";

setupWelcome("picture-sheet", WELCOME);
addBackLink();

/** @typedef {import("./pictures.js").Picture} Picture */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** Every picture, in the tray's order (which is also the sheet's). @type {Picture[]} */
let pictures = [];
/** Ids of the pictures on the sheet. @type {Set<string>} */
const onSheet = new Set();
const decoded = createDecodedCache();
/** Incremented by every redraw. */
let busy = 0;
/** Incremented by "Remove all", so files still being read are dropped. */
let generation = 0;
/** Files waiting to be read, one at a time. @type {File[]} */
const queue = [];
let reading = false;

/** The pictures on the sheet, in order. */
const sheetPictures = () => pictures.filter((p) => onSheet.has(p.id));

/* ═══════════════════════════════════════════════════════════
   Adding pictures
   ═══════════════════════════════════════════════════════════ */

/**
 * Queue files to be read. Anything beyond the limit is turned away at once.
 *
 * @param {Iterable<File>} files
 */
function addFiles(files) {
  const list = [...files];
  if (!list.length) return;
  const room = MAX_PICTURES - pictures.length - queue.length;
  const take = list.slice(0, Math.max(0, room));
  const turnedAway = list.length - take.length;
  if (turnedAway)
    showProblems([
      `${turnedAway} ${turnedAway === 1 ? "picture was" : "pictures were"} left out: ${MAX_PICTURES} is as many as the app holds.`,
    ]);
  else showProblems([]);
  queue.push(...take);
  readQueue();
}

/** Read the queued files, one after another, so only one is decoded at a time. */
async function readQueue() {
  if (reading) return;
  reading = true;
  const mine = generation;
  /** @type {string[]} */
  const problems = [];
  let done = 0;
  const total = () => done + queue.length;
  try {
    while (queue.length && mine === generation) {
      const file = /** @type {File} */ (queue.shift());
      progress(`Reading picture ${done + 1} of ${total()}`, true);
      const got = await readPicture(file);
      done++;
      if (mine !== generation) break;
      if ("why" in got) {
        problems.push(`${cleanText(file.name || "A pasted picture", 60)}: ${got.why}`);
        continue;
      }
      pictures.push(got.picture);
      if (onSheet.size < MAX_ON_SHEET) onSheet.add(got.picture.id);
      $("trayGrid").append(tileFor(got.picture));
      updateTray();
    }
  } finally {
    reading = false;
    progress(null);
  }
  if (mine === generation) {
    if (problems.length) showProblems(problems);
    refresh();
  }
  // Files dropped while the last batch was finishing.
  if (queue.length) readQueue();
}

/**
 * List what couldn't be used, as text.
 *
 * @param {string[]} lines
 */
function showProblems(lines) {
  const ul = $("problems");
  ul.replaceChildren(...lines.slice(0, 20).map((t) => el("li", "", t)));
  if (lines.length > 20) ul.append(el("li", "", `…and ${lines.length - 20} more.`));
  ul.hidden = !lines.length;
}

/* ═══════════════════════════════════════════════════════════
   The tray
   ═══════════════════════════════════════════════════════════ */

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 */
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text; // text, never markup
  return e;
}

/**
 * @param {string} text
 * @param {string} title
 * @param {() => void} onClick
 */
function smallButton(text, title, onClick) {
  const b = /** @type {HTMLButtonElement} */ (el("button", "mini", text));
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", onClick);
  return b;
}

/**
 * One picture in the tray: the thumbnail (click to put it on the sheet or
 * take it off), its label, and buttons to move or remove it.
 *
 * @param {Picture} p
 */
function tileFor(p) {
  const tile = el("div", "tile");
  tile.dataset.id = p.id;

  const thumb = el("button", "thumb");
  thumb.setAttribute("type", "button");
  p.thumb.className = "pic";
  thumb.append(p.thumb, el("span", "rank"));
  thumb.addEventListener("click", () => toggle(p.id));

  const meta = el("div", "meta");
  const label = /** @type {HTMLInputElement} */ (el("input", "label"));
  label.type = "text";
  label.maxLength = MAX_LABEL;
  label.placeholder = "Label (optional)";
  label.autocomplete = "off";
  label.setAttribute("aria-label", "Label for this picture");
  label.addEventListener("input", () => {
    p.label = cleanText(label.value, MAX_LABEL);
    if (onSheet.has(p.id)) refreshSoon();
  });

  const row = el("div", "row");
  row.append(
    smallButton("←", "Move earlier", () => move(p.id, -1)),
    smallButton("→", "Move later", () => move(p.id, 1)),
    el("span", "file", cleanText(p.fileName, 60)),
    smallButton("✕", "Remove this picture", () => remove(p.id)),
  );
  meta.append(label, row);
  tile.append(thumb, meta);
  return tile;
}

/** Bring every tile and the count up to date. */
function updateTray() {
  const order = sheetPictures().map((p) => p.id);
  for (const tile of /** @type {HTMLElement[]} */ ([...$("trayGrid").children])) {
    const id = tile.dataset.id || "";
    const at = order.indexOf(id);
    const on = at >= 0;
    tile.classList.toggle("on", on);
    const thumb = /** @type {HTMLElement} */ (tile.querySelector(".thumb"));
    thumb.title = on ? "Take off the sheet" : "Put on the sheet";
    thumb.setAttribute("aria-pressed", String(on));
    /** @type {HTMLElement} */ (tile.querySelector(".rank")).textContent = on ? String(at + 1) : "";
  }
  const n = pictures.length;
  $("trayCount").textContent = n
    ? `${n} ${n === 1 ? "picture" : "pictures"} · ${onSheet.size} of ${MAX_ON_SHEET} on the sheet`
    : "";
  $("clearAll").hidden = !n;
  $("drop").classList.toggle("compact", n > 0);
}

/** @param {string} id */
function toggle(id) {
  if (onSheet.has(id)) onSheet.delete(id);
  else if (onSheet.size >= MAX_ON_SHEET) {
    note(`${MAX_ON_SHEET} is as many as fit on one sheet.`);
    return;
  } else onSheet.add(id);
  note("");
  updateTray();
  refresh();
}

/**
 * @param {string} id
 * @param {number} by -1 earlier, 1 later
 */
function move(id, by) {
  const i = pictures.findIndex((p) => p.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= pictures.length) return;
  [pictures[i], pictures[j]] = [pictures[j], pictures[i]];
  // Moving a tile can take the focus off the button pressed; give it back.
  const active = /** @type {HTMLElement | null} */ (document.activeElement);
  const grid = $("trayGrid");
  const tiles = [...grid.children];
  const a = tiles[i];
  const b = tiles[j];
  if (by < 0) grid.insertBefore(a, b);
  else grid.insertBefore(b, a);
  active?.focus();
  updateTray();
  if (onSheet.has(id)) refresh();
}

/** @param {string} id */
function remove(id) {
  pictures = pictures.filter((p) => p.id !== id);
  const was = onSheet.delete(id);
  for (const t of /** @type {HTMLElement[]} */ ([...$("trayGrid").children]))
    if (t.dataset.id === id) t.remove();
  updateTray();
  if (was) refresh();
}

function removeAll() {
  generation++;
  queue.length = 0;
  pictures = [];
  onSheet.clear();
  $("trayGrid").replaceChildren();
  showProblems([]);
  updateTray();
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Drawing and export
   ═══════════════════════════════════════════════════════════ */

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#f1ebe0"),
    bg: safeColour($("bgColor").value, "#16130f"),
    at: safeColour($("atColor").value, "#a69c8a"),
    transparent: $("optTransparent").checked,
    caption: cleanText($("capText").value, 120),
    captionScale: scaleOf("capSize"),
    capTop: isPressed("capTop"),
    credit: cleanText($("credText").value, MAX_CREDIT),
    creditScale: scaleOf("credSize"),
  };
}

/** What goes on the sheet: each picture with what is printed under it. */
function sheetContent() {
  const show = { numbers: $("optNumbers").checked, labels: $("optLabels").checked };
  const list = sheetPictures();
  decoded.keepOnly(new Set(list.map((p) => p.id)));
  const byId = new Map(list.map((p) => [p.id, p]));
  return {
    items: list.map((p, i) => ({ id: p.id, name: sheetLabel(i, p.label, show) })),
    /** @param {string} id */
    decode: (id) => {
      const p = byId.get(id);
      return p ? decoded.get(p) : Promise.reject(new Error("gone"));
    },
  };
}

async function refresh() {
  const token = ++busy;
  syncUI();
  if (!onSheet.size) {
    $("sheetWrap").hidden = true;
    return;
  }
  try {
    await loadFontFamilies(["Literata", "Inter"]);
    const { items, decode } = sheetContent();
    // Drawn off screen and copied in, so a slow redraw never shows half a sheet.
    const canvas = document.createElement("canvas");
    await drawSheet(canvas, currentOptions(), items, decode);
    if (token !== busy) return;
    const shown = /** @type {HTMLCanvasElement} */ ($("sheet"));
    shown.width = canvas.width;
    shown.height = canvas.height;
    /** @type {CanvasRenderingContext2D} */ (shown.getContext("2d")).drawImage(canvas, 0, 0);
    $("sheetWrap").hidden = false;
  } catch (e) {
    if (token === busy) note("Couldn't draw the sheet: " + cleanText(e && e.message, 80), true);
  }
}
const refreshSoon = debounce(refresh, 300);

function syncUI() {
  const ready = onSheet.size > 0;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("capPosField").hidden = !cleanText($("capText").value, 120);
}

/**
 * @param {string} type
 * @param {string} ext
 */
async function exportSheet(type, ext) {
  if (!onSheet.size) return;
  const opts = currentOptions();
  if (type === "image/jpeg") opts.transparent = false;
  progress("Rendering for export", true);
  try {
    const canvas = document.createElement("canvas");
    await loadFontFamilies(["Literata", "Inter"]);
    const { items, decode } = sheetContent();
    await drawSheet(canvas, opts, items, decode);
    const blob = await canvasToBlob(canvas, type);
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }
    // Never the pictures' own file names: they often say what they show.
    downloadBlob(
      blob,
      `picture-sheet-${hashSlug(items.map((i) => i.id).join("|") + Date.now())}.${ext}`,
    );
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  } finally {
    progress(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Looks
   ═══════════════════════════════════════════════════════════ */

/** @param {import("../../shared/looks.js").Look} look */
const lookToControls = (look) => ({
  set: { fgColor: look.ink, bgColor: look.paper, atColor: look.ink },
});

/** @param {string} id */
function applyLook(id) {
  const look = LOOKS.find((l) => l.id === id);
  if (!look) return;
  for (const [ctl, value] of Object.entries(lookToControls(look).set)) {
    const input = $(ctl);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  $("look").value = id;
  refresh();
}

$("look").replaceChildren(...LOOKS.map((l) => new Option(l.name, l.id)));
$("look").addEventListener("change", () => applyLook($("look").value));
$("rndLook").addEventListener("click", () => {
  const id = pickOther(
    LOOKS.map((l) => l.id),
    $("look").value,
  );
  if (id) applyLook(id);
});

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

for (const id of ["addBtn", "addBtnRail"])
  $(id).addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", () => {
  const input = /** @type {HTMLInputElement} */ ($("fileInput"));
  addFiles(input.files || []);
  input.value = ""; // so the same file can be chosen again
});
$("clearAll").addEventListener("click", removeAll);

// Drop anywhere on the page. Without this, a file dropped beside the drop
// zone would make the browser open it in place of the app.
/** @param {DragEvent} e */
const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
window.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  /** @type {DataTransfer} */ (e.dataTransfer).dropEffect = "copy";
  $("drop").classList.add("over");
});
window.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) $("drop").classList.remove("over");
});
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  $("drop").classList.remove("over");
  addFiles(/** @type {DataTransfer} */ (e.dataTransfer).files);
});
// Paste a picture (a screenshot, say). Text pasted into a field is left alone.
document.addEventListener("paste", (e) => {
  const files = e.clipboardData ? [...e.clipboardData.files] : [];
  if (!files.length) return;
  e.preventDefault();
  addFiles(files);
});

for (const id of ["optLabels", "optNumbers", "optTransparent"])
  $(id).addEventListener("change", refresh);
$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
for (const id of ["customW", "customH"]) $(id).addEventListener("input", debounce(refresh, 400));
for (const id of ["capText", "credText"])
  $(id).addEventListener("input", () => {
    syncUI();
    refreshSoon();
  });
$("capTop").addEventListener("click", () => {
  setSeg($("capTop"), $("capBottom"));
  refresh();
});
$("capBottom").addEventListener("click", () => {
  setSeg($("capBottom"), $("capTop"));
  refresh();
});
bindColour("fgColor", "fgHex", refresh);
bindColour("bgColor", "bgHex", refresh);
bindColour("atColor", "atHex", refresh);
bindScale("capSize", debounce(refresh, 150));
bindScale("credSize", debounce(refresh, 150));

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

applyLook(LOOKS[0].id);
updateTray();
syncUI();
