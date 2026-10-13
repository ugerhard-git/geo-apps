/**
 * Geo imagery — planning and loading WMS requests to NASA GIBS and EOX.
 */

import { EOX_WMS, GIBS, MAX_SUB } from "./config.js";
import { own } from "../../shared/util.js";
import { worldHalf } from "./projections.js";

/* ═══════════════════════════════════════════════════════════
   WMS request planning
   ═══════════════════════════════════════════════════════════ */

/*
  WMS composites every requested layer in one call, so one unavailable overlay
  used to take the whole request down with it — and the old all-or-nothing
  retry then silently dropped the overlays that were fine. Probe each overlay
  once per projection with a 2 px request and keep the ones that answer.
*/
export const overlayProbe = new Map();

export async function usableOverlays(crs, ids, box, time) {
  const out = [];
  for (const id of ids) {
    const key = crs + "|" + id;
    if (!overlayProbe.has(key)) {
      try {
        await loadImage(wmsUrl(crs, box, 2, 2, [id], time));
        overlayProbe.set(key, true);
      } catch (e) {
        overlayProbe.set(key, false);
      }
    }
    if (overlayProbe.get(key)) out.push(id);
  }
  return out;
}

export function wmsUrl(crs, box, w, h, layers, time, host) {
  const p = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: layers.join(","),
    STYLES: "",
    SRS: "EPSG:" + crs,
    BBOX: [box.x0, box.y0, box.x1, box.y1].join(","),
    WIDTH: String(w),
    HEIGHT: String(h),
    FORMAT: "image/jpeg",
  });
  if (time) p.set("TIME", time);

  if (host === "eox") {
    // EOX publishes EPSG:4326 only; callers resample for other projections.
    if (crs !== "4326") throw new Error("this source is EPSG:4326 only");
    return EOX_WMS + "?" + p.toString();
  }
  const endpoint = own(GIBS, crs);
  if (!endpoint) throw new Error("unknown projection");
  return endpoint + "?" + p.toString();
}

/*
  Split the plane box into requests that the server will accept:
  first across the dateline, then into a grid no larger than MAX_SUB.
*/
export function planRequests(box, crs, W, H) {
  const half = worldHalf(crs);
  const panels = [];

  if (box.x1 > half) {
    const splitFrac = (half - box.x0) / (box.x1 - box.x0);
    const wA = Math.round(W * splitFrac);
    panels.push({ x0: box.x0, x1: half, px: 0, pw: wA });
    panels.push({ x0: -half, x1: box.x1 - 2 * half, px: wA, pw: W - wA });
  } else {
    panels.push({ x0: box.x0, x1: box.x1, px: 0, pw: W });
  }

  const jobs = [];
  for (const pan of panels) {
    if (pan.pw <= 0) continue;
    const cols = Math.ceil(pan.pw / MAX_SUB);
    const rows = Math.ceil(H / MAX_SUB);
    for (let c = 0; c < cols; c++) {
      const px0 = Math.round((pan.pw * c) / cols),
        px1 = Math.round((pan.pw * (c + 1)) / cols);
      for (let r = 0; r < rows; r++) {
        const py0 = Math.round((H * r) / rows),
          py1 = Math.round((H * (r + 1)) / rows);
        jobs.push({
          dx: pan.px + px0,
          dy: py0,
          dw: px1 - px0,
          dh: py1 - py0,
          box: {
            x0: pan.x0 + ((pan.x1 - pan.x0) * px0) / pan.pw,
            x1: pan.x0 + ((pan.x1 - pan.x0) * px1) / pan.pw,
            // canvas y grows downward, the plane grows upward
            y1: box.y1 - ((box.y1 - box.y0) * py0) / H,
            y0: box.y1 - ((box.y1 - box.y0) * py1) / H,
          },
        });
      }
    }
  }
  return jobs;
}

/*
  GIBS is expected to send Access-Control-Allow-Origin, which keeps the canvas
  clean and lets us export from it. If it doesn't, an anonymous request fails
  outright, so fall back to a plain request: the picture still displays, the
  canvas just becomes read-blocked and export switches to the direct-URL route.
*/
let CORS_MODE = "unknown"; // "unknown" | "anonymous" | "none"

/**
 * Shared with the rendering code: `tainted` becomes true once an image had to
 * be loaded without CORS, after which the canvas can no longer be read back.
 */
export const corsState = { tainted: false };

export function fetchImage(url, anonymous) {
  return new Promise((res, rej) => {
    const img = new Image();
    if (anonymous) img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("request failed"));
    img.src = url;
  });
}

export async function loadImage(url) {
  if (CORS_MODE === "none") return fetchImage(url, false);
  try {
    const img = await fetchImage(url, true);
    CORS_MODE = "anonymous";
    return img;
  } catch (e) {
    if (CORS_MODE === "anonymous") throw e; // CORS works; this is a genuine failure
    const img = await fetchImage(url, false); // succeeds only if the server is reachable
    CORS_MODE = "none";
    corsState.tainted = true;
    return img;
  }
}

/* Run tasks a few at a time rather than firing every tile at once. */
export async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}
