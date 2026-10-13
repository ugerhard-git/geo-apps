/**
 * Licence plates — the blur-region editor.
 *
 * Shows one plate large; dragging draws a box to blur (the registration
 * characters, a country code on a Euroband), clicking a box removes it.
 * Boxes are stored on the plate as fractions of the image, so they apply at
 * any size.
 *
 * Expects #editor, #editTitle, #editCanvas, #editClear and #editClose.
 */

import { $, note } from "../../shared/dom.js";
import { clamp } from "../../shared/util.js";

/**
 * @typedef {object} EditorOptions
 * @property {(url: string) => Promise<HTMLImageElement>} loadImage
 * @property {Map<string, HTMLImageElement>} imageCache where loaded images can be found again
 * @property {() => void} onChange the plate's regions changed; redraw the sheet
 * @property {() => void} onRegionAdded a region was drawn (switch to "drawn regions" mode)
 */

/**
 * @param {EditorOptions} options
 */
export function createRegionEditor({ loadImage, imageCache, onChange, onRegionAdded }) {
  const canvas = $("editCanvas");
  /** @type {import("./commons-data.js").Plate | null} the plate being edited */
  let editing = null;
  /** @type {{x0: number, y0: number, x1: number, y1: number} | null} box being dragged */
  let drag = null;

  function draw() {
    if (!editing) return;
    const ctx = canvas.getContext("2d");
    const img = imageCache.get(editing.thumb);
    if (!img) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#f2c14e";
    ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(242,193,78,0.22)";
    for (const r of editing.regions) {
      const x = r.x * canvas.width;
      const y = r.y * canvas.height;
      const w = r.w * canvas.width;
      const h = r.h * canvas.height;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    if (drag) {
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0);
      ctx.setLineDash([]);
    }
  }

  /**
   * Pointer position in canvas pixels.
   *
   * @param {PointerEvent} e
   */
  function pointAt(e) {
    const box = canvas.getBoundingClientRect();
    return {
      x: clamp((e.clientX - box.left) / box.width, 0, 1) * canvas.width,
      y: clamp((e.clientY - box.top) / box.height, 0, 1) * canvas.height,
    };
  }

  /**
   * Open the editor on a plate.
   *
   * @param {import("./commons-data.js").Plate} rec
   */
  async function open(rec) {
    editing = rec;
    $("editor").hidden = false;
    $("editTitle").textContent = "Blur regions";
    try {
      const img = await loadImage(rec.thumb);
      const w = Math.min(760, img.naturalWidth || img.width);
      const scale = w / (img.naturalWidth || img.width);
      canvas.width = w;
      canvas.height = Math.round((img.naturalHeight || img.height) * scale);
      draw();
    } catch {
      note("Couldn't load that image for editing.", true);
      $("editor").hidden = true;
    }
  }

  function close() {
    editing = null;
    $("editor").hidden = true;
  }

  canvas.addEventListener("pointerdown", (/** @type {PointerEvent} */ e) => {
    if (!editing) return;
    const p = pointAt(e);
    // A click inside an existing box removes it.
    const hit = editing.regions.findIndex(
      (r) =>
        p.x >= r.x * canvas.width &&
        p.x <= (r.x + r.w) * canvas.width &&
        p.y >= r.y * canvas.height &&
        p.y <= (r.y + r.h) * canvas.height,
    );
    if (hit >= 0) {
      editing.regions.splice(hit, 1);
      draw();
      onChange();
      return;
    }
    drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (/** @type {PointerEvent} */ e) => {
    if (!drag) return;
    const p = pointAt(e);
    drag.x1 = p.x;
    drag.y1 = p.y;
    draw();
  });

  canvas.addEventListener("pointerup", () => {
    if (!drag || !editing) {
      drag = null;
      return;
    }
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    drag = null;
    if (w > 6 && h > 6) {
      editing.regions.push({
        x: x / canvas.width,
        y: y / canvas.height,
        w: w / canvas.width,
        h: h / canvas.height,
      });
      onRegionAdded();
    }
    draw();
  });

  $("editClear").addEventListener("click", () => {
    if (editing) {
      editing.regions = [];
      draw();
      onChange();
    }
  });
  $("editClose").addEventListener("click", close);

  return { open, close };
}
