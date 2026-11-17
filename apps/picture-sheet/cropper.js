/**
 * Picture Sheet — the cropping window: the picture large, and a rectangle to
 * draw, move and resize over it. The part outside the rectangle is dimmed.
 *
 * Works with a mouse, a finger or a pen (pointer events), and with the
 * keyboard: arrow keys move the rectangle, Shift and the arrow keys resize it.
 * With nothing marked yet, an arrow key marks the middle of the picture.
 *
 * The rectangle is held as fractions of the picture (crop.js), so what is
 * shown here at one size is cut from the kept copy at another.
 */

import { $ } from "../../shared/dom.js";
import { BLURRY_PX, CROP_VIEW_SIDE, MIN_CROP_PX } from "./config.js";
import { cropPixels, dragCrop, isWhole, normalise, nudge } from "./crop.js";
import { decodePart } from "./pictures.js";

/** @typedef {import("./crop.js").Crop} Crop */
/** @typedef {import("./crop.js").DragMode} DragMode */
/** @typedef {import("./pictures.js").Picture} Picture */

const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/**
 * Wire up the window. `onDone` is called with the picture after its crop
 * changed (set, or removed); Cancel and Escape change nothing.
 *
 * @param {(p: Picture) => void} onDone
 */
export function setupCropper(onDone) {
  const dialog = /** @type {HTMLDialogElement} */ ($("cropper"));
  const stage = /** @type {HTMLElement} */ ($("cropStage"));
  const canvas = /** @type {HTMLCanvasElement} */ ($("cropCanvas"));
  const sel = /** @type {HTMLElement} */ ($("cropSel"));

  /** @type {Picture | null} */
  let picture = null;
  /** @type {Crop | null} */
  let current = null;
  /** The smallest rectangle, as fractions of the picture. */
  let min = { w: 0.01, h: 0.01 };
  /** @type {{mode: DragMode, from: {x: number, y: number}, start: Crop | null, id: number} | null} */
  let drag = null;

  /** Show the rectangle and say how large it is. */
  function show() {
    sel.hidden = !current;
    if (current) {
      sel.style.left = `${current.x * 100}%`;
      sel.style.top = `${current.y * 100}%`;
      sel.style.width = `${current.w * 100}%`;
      sel.style.height = `${current.h * 100}%`;
    }
    stage.classList.toggle("marked", !!current);
    const p = picture;
    if (!p) return;
    const info = $("cropInfo");
    if (!current || isWhole(current)) {
      info.textContent = `The whole picture: ${p.w.toLocaleString("en-GB")} × ${p.h.toLocaleString("en-GB")} pixels.`;
      info.classList.remove("warn");
    } else {
      const { sw, sh } = cropPixels(current, p.w, p.h);
      const small = Math.min(sw, sh) < BLURRY_PX;
      info.textContent =
        `The part marked: ${sw.toLocaleString("en-GB")} × ${sh.toLocaleString("en-GB")} pixels.` +
        (small ? " That's small: it may look blurry on a large sheet." : "");
      info.classList.toggle("warn", small);
    }
    $("cropUse").disabled = !current || isWhole(current);
  }

  /**
   * A pointer's position as fractions of the picture, which may lie outside it.
   *
   * @param {PointerEvent} e
   */
  function at(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / (r.width || 1), y: (e.clientY - r.top) / (r.height || 1) };
  }

  stage.addEventListener("pointerdown", (e) => {
    if (!picture || e.button > 0) return;
    const target = /** @type {HTMLElement} */ (e.target);
    /** @type {DragMode} */
    let mode = "new";
    const handle = target.dataset?.h;
    if (handle && current) mode = /** @type {DragMode} */ (handle);
    else if (current && target === sel) mode = "move";
    drag = { mode, from: at(e), start: current, id: e.pointerId };
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const next = dragCrop(drag.start, drag.mode, drag.from, at(e), min);
    // A new rectangle still too small to count leaves the old one in place,
    // so a click without a drag changes nothing.
    current = next || (drag.mode === "new" ? drag.start : current);
    show();
  });
  /** @param {PointerEvent} e */
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);

  stage.addEventListener("keydown", (e) => {
    if (!picture || !ARROWS.has(e.key)) return;
    e.preventDefault();
    current = current
      ? nudge(current, e.key, e.shiftKey, min)
      : { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    show();
  });

  /** @param {Crop | null} crop */
  function finish(crop) {
    const p = picture;
    picture = null;
    dialog.close();
    if (!p) return;
    p.crop = crop && !isWhole(crop) ? normalise(crop) : null;
    onDone(p);
  }
  $("cropUse").addEventListener("click", () => finish(current));
  $("cropWhole").addEventListener("click", () => finish(null));
  $("cropCancel").addEventListener("click", () => {
    picture = null;
    dialog.close();
  });
  dialog.addEventListener("close", () => {
    picture = null;
    drag = null;
    canvas.width = canvas.height = 0; // let the memory go
  });

  /**
   * Open the window on a picture.
   *
   * @param {Picture} p
   */
  let opening = false;
  return async function openCropper(p) {
    // A second click while the picture is still being opened is ignored.
    if (opening || dialog.open) return;
    opening = true;
    try {
      const b = await decodePart(p, CROP_VIEW_SIDE, true);
      try {
        canvas.width = b.width;
        canvas.height = b.height;
        /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d")).drawImage(b, 0, 0);
      } finally {
        b.close();
      }
    } catch {
      return; // the picture couldn't be opened; nothing to crop
    } finally {
      opening = false;
    }
    picture = p;
    current = p.crop;
    min = { w: Math.min(1, MIN_CROP_PX / p.w), h: Math.min(1, MIN_CROP_PX / p.h) };
    show();
    dialog.showModal();
    stage.focus();
  };
}
