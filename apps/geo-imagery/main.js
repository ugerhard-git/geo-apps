/**
 * Geo imagery — satellite and night-time imagery of a country or city, framed
 * and captioned for a quiz sheet.
 *
 * Imagery comes from NASA GIBS and EOX over WMS. Country outlines and cities
 * come from Natural Earth, with Wikidata filling gaps.
 *
 * Modules: config.js (layers and data sources), projections.js, countries.js,
 * cities.js, framing.js and wms.js. This file holds the page state, the
 * rendering and caption pipeline, and the wiring.
 */

import { clamp, own } from "../../shared/util.js";
import { $, note, setSeg } from "../../shared/dom.js";
import { HEX6, safeColour } from "../../shared/colour.js";
import { BIDI_AND_CONTROL, norm } from "../../shared/text.js";
import {
  ALIASES,
  LAYERS,
  MAX_PIXELS,
  OVERLAY_LABEL,
  OVERLAY_LAYERS,
  PREVIEW_H,
  TOPO_URL,
  US_STATES,
} from "./config.js";
import {
  eeLatOf,
  eeLonPerX,
  eeTheta,
  MAX_MERC_LAT,
  merY,
  project,
  R_EARTH,
  worldHalf,
} from "./projections.js";
import { corsState, loadImage, planRequests, pool, usableOverlays, wmsUrl } from "./wms.js";
import { bboxFor, planeBox } from "./framing.js";
import {
  CITIES,
  cityBBox,
  cleanName,
  loadCities,
  searchWikidataCities,
  URBAN,
  urbanFallbackNote,
  urbanFor,
} from "./cities.js";
import { buildCountry, mainlandSet, topoToFeatures } from "./countries.js";
import { isNum } from "../../shared/geo.js";

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {any[]} every country with an outline, from Natural Earth */
let COUNTRIES = [];
/** @type {any} the country or city being shown */
let current = null;

/* ═══════════════════════════════════════════════════════════
   Reading the controls that rendering depends on
   ═══════════════════════════════════════════════════════════ */

const nudgeX = () => clamp((+$("nudgeX").value || 0) / 100, -1, 1);
const nudgeY = () => clamp((+$("nudgeY").value || 0) / 100, -1, 1);

function requestedOverlays() {
  const ids = [];
  for (const [chk, layer] of Object.entries(OVERLAY_LAYERS)) {
    if ($(chk).checked) ids.push(layer);
  }
  return ids;
}

function activeLayerIds() {
  return [$("layer").value, ...requestedOverlays()];
}

/* ═══════════════════════════════════════════════════════════
   Rendering
   ═══════════════════════════════════════════════════════════ */

/*
  Grow a box until it matches a target aspect, keeping the country centred.
  Growing vertically can run into the projection's latitude ceiling; when it
  does we clamp and slide the box instead, which keeps the country wholly
  visible at the cost of it no longer sitting dead centre.
*/
function expandToAspect(box, crs, target) {
  const yLimit = crs === "3857" ? merY(MAX_MERC_LAT) : 90;
  const half = worldHalf(crs);
  let { x0, x1, y0, y1 } = box;
  const w = x1 - x0,
    h = y1 - y0;
  const a = w / h;
  let offCentre = false;

  if (a < target) {
    // too narrow — widen
    const nw = h * target,
      cx = (x0 + x1) / 2;
    x0 = cx - nw / 2;
    x1 = cx + nw / 2;
    if (x1 - x0 > 2 * half) {
      x0 = -half;
      x1 = half;
    }
    if (x0 < -half) {
      x0 += 2 * half;
      x1 += 2 * half;
    }
  } else if (a > target) {
    // too wide — heighten
    const nh = w / target,
      cy = (y0 + y1) / 2;
    y0 = cy - nh / 2;
    y1 = cy + nh / 2;
    if (nh >= 2 * yLimit) {
      y0 = -yLimit;
      y1 = yLimit;
      offCentre = true;
    } else if (y1 > yLimit) {
      const d = y1 - yLimit;
      y1 -= d;
      y0 -= d;
      offCentre = true;
    } else if (y0 < -yLimit) {
      const d = -yLimit - y0;
      y0 += d;
      y1 += d;
      offCentre = true;
    }
  }
  return { x0, x1, y0, y1, offCentre };
}

/*
  Fetch imagery for a plane box and paint it into ctx at (dx, dy).
  Returns true if reference overlays had to be dropped.
*/
async function fetchInto(ctx, box, crs, w, h, dx, dy, time, onProgress, host) {
  const wanted = host === "eox" ? [] : requestedOverlays();
  const usable = await usableOverlays(crs, wanted, box, time);
  const dropped = wanted.filter((id) => !usable.includes(id));
  const layers = [$("layer").value, ...usable];

  const jobs = planRequests(box, crs, w, h);
  let done = 0;
  const total = jobs.length;

  const runAll = async (ids) => {
    const imgs = await pool(jobs, 5, async (j) => {
      const img = await loadImage(wmsUrl(crs, j.box, j.dw, j.dh, ids, time, host));
      done++;
      onProgress && onProgress(done / total);
      return img;
    });
    imgs.forEach((img, i) => {
      const j = jobs[i];
      ctx.drawImage(img, dx + j.dx, dy + j.dy, j.dw, j.dh);
    });
  };

  try {
    await runAll(layers);
  } catch (e) {
    if (layers.length > 1) {
      // Something else went wrong mid-composite; the base layer alone is
      // better than nothing.
      done = 0;
      await runAll([layers[0]]);
      return wanted.slice();
    }
    throw e;
  }
  return dropped;
}

/*
  Both Web Mercator and Equal Earth are cylindrical in the sense that matters
  here: a row of output pixels is a single line of latitude, and longitude maps
  linearly to x along it. That is what lets a whole reprojection be one
  drawImage per row — no pixel reads, so it survives a tainted canvas.
*/
const ROW_MAP = {
  3857: {
    latOf: (y) => ((2 * Math.atan(Math.exp(y / R_EARTH)) - Math.PI / 2) * 180) / Math.PI,
    lonPerX: () => 180 / Math.PI / R_EARTH,
  },
  eqearth: {
    latOf: (y) => eeLatOf(y),
    lonPerX: (y) => eeLonPerX(eeTheta(y / R_EARTH)),
  },
};

/*
  The geographic window a projected box needs. Longitude spreads widest on
  the row furthest from the equator, so sample across the box rather than
  trusting the corners.
*/
function eeSourceWindow(box, crs) {
  let lonLo = Infinity,
    lonHi = -Infinity,
    latLo = Infinity,
    latHi = -Infinity;
  let lonSpanMin = Infinity,
    latStepMin = Infinity;
  const N = 96;
  let prevLat = null;
  const map = own(ROW_MAP, crs);
  if (!map) throw new Error("no row map for " + crs);

  for (let i = 0; i <= N; i++) {
    const y = box.y0 + ((box.y1 - box.y0) * i) / N;
    const lat = map.latOf(y);
    if (lat === null || !Number.isFinite(lat)) {
      prevLat = null;
      continue;
    }
    const k = map.lonPerX(y);
    const l0 = Math.min(k * box.x0, k * box.x1),
      l1 = Math.max(k * box.x0, k * box.x1);

    lonLo = Math.min(lonLo, l0);
    lonHi = Math.max(lonHi, l1);
    latLo = Math.min(latLo, lat);
    latHi = Math.max(latHi, lat);
    lonSpanMin = Math.min(lonSpanMin, l1 - l0);
    if (prevLat !== null) latStepMin = Math.min(latStepMin, Math.abs(lat - prevLat));
    prevLat = lat;
  }
  if (!Number.isFinite(lonLo)) throw new Error("box lies outside the projection");

  // A little slack so edge rows never sample past the fetched image.
  const mx = (lonHi - lonLo) * 0.004 + 0.02;
  const my = (latHi - latLo) * 0.004 + 0.02;
  const win = {
    lon0: lonLo - mx,
    lon1: lonHi + mx,
    lat0: Math.max(-90, latLo - my),
    lat1: Math.min(90, latHi + my),
  };

  /*
    A tall Equal Earth frame spans far more longitude on its polar rows than on
    its equatorial ones. Sizing the source to the window alone would starve the
    narrow rows — which is exactly where the country sits — so scale the source
    up by how much wider the window is than the tightest row.
  */
  win.lonOversample =
    Number.isFinite(lonSpanMin) && lonSpanMin > 0
      ? clamp((win.lon1 - win.lon0) / lonSpanMin, 1, 8)
      : 1;
  win.latOversample =
    Number.isFinite(latStepMin) && latStepMin > 0
      ? clamp((win.lat1 - win.lat0) / (latStepMin * N), 1, 8)
      : 1;

  return win;
}

/* Resample an equirectangular source into the target projection, row by row. */
function reprojectFrom4326(src, win, box, crs, ctx, dx, dy, W, H) {
  const map = own(ROW_MAP, crs);
  if (!map) throw new Error("no row map for " + crs);
  const lonSpan = win.lon1 - win.lon0,
    latSpan = win.lat1 - win.lat0;
  const sw = src.width,
    sh = src.height;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  for (let py = 0; py < H; py++) {
    const y = box.y1 - ((py + 0.5) / H) * (box.y1 - box.y0);
    const lat = map.latOf(y);
    if (lat === null || !Number.isFinite(lat)) continue; // outside the projection

    const k = map.lonPerX(y);
    const u0 = ((k * box.x0 - win.lon0) / lonSpan) * sw;
    const u1 = ((k * box.x1 - win.lon0) / lonSpan) * sw;
    const uw = u1 - u0;
    if (!(uw > 0)) continue;

    const v = clamp(Math.floor(((win.lat1 - lat) / latSpan) * sh), 0, sh - 1);
    ctx.drawImage(src, u0, v, uw, 1, dx, dy + py, W, 1);
  }
}

/*
  Draw the imagery. spec is either {mode:"fit", H} or
  {mode:"fixed", W, H, letterbox}. Captions are applied afterwards by
  composeText, so one set of network requests serves both the clean and
  the captioned export.
*/
async function render(canvas, spec, onProgress) {
  if (!current) return null;

  const crs = $("proj").value;
  const bb = subjectBBox();
  if (!bb) throw new Error("nothing selected");
  let box = planeBox(bb, crs, +$("pad").value, nudgeX(), nudgeY());

  let natAspect = (box.x1 - box.x0) / (box.y1 - box.y0);
  // A malformed outline could give a zero-height or infinite box; refuse rather
  // than hand the canvas a NaN size.
  if (!Number.isFinite(natAspect) || natAspect <= 0) throw new Error("degenerate bounding box");
  natAspect = clamp(natAspect, 1 / 64, 64);

  let w,
    h,
    dx = 0,
    dy = 0,
    offCentre = false;

  if (spec.mode === "fixed") {
    w = spec.W;
    h = spec.H;
    if (spec.letterbox) {
      // Keep the country's own proportions and centre them in the frame.
      if (natAspect > w / h) {
        dx = 0;
        h = Math.round(w / natAspect);
        dy = Math.round((spec.H - h) / 2);
      } else {
        dy = 0;
        w = Math.round(h * natAspect);
        dx = Math.round((spec.W - w) / 2);
      }
    } else {
      const grown = expandToAspect(box, crs, w / h);
      offCentre = grown.offCentre;
      box = grown;
    }
  } else {
    h = spec.H;
    w = Math.round(spec.H * natAspect);
  }

  if (spec.mode !== "fixed" && w * h > MAX_PIXELS) {
    // Native size with 10 m imagery can ask for more canvas than exists.
    const k = Math.sqrt(MAX_PIXELS / (w * h));
    w = Math.max(16, Math.round(w * k));
    h = Math.max(16, Math.round(h * k));
  }
  const outW = spec.mode === "fixed" ? spec.W : w;
  const outH = spec.mode === "fixed" ? spec.H : h;
  if (outW * outH > MAX_PIXELS) throw new Error("frame too large");

  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, outW, outH);

  w = clamp(w, 16, 16000);
  h = clamp(h, 16, 16000);

  const time = currentLayer().dated ? $("date").value : "";
  let droppedOverlays;

  const srcHost = currentLayer().host || "gibs";
  // Equal Earth has no server endpoint; EOX publishes 4326 only. Either way
  // the fix is the same: fetch equirectangular and resample.
  const needsResample = crs !== "4326" && (crs === "eqearth" || currentLayer().only4326);

  if (needsResample) {
    const win = eeSourceWindow(box, crs);
    let sw = clamp(Math.ceil(w * 1.15 * win.lonOversample), 16, 16000);
    let sh = clamp(Math.ceil(h * 1.15 * win.latOversample), 16, 16000);
    if (sw * sh > MAX_PIXELS) {
      const k = Math.sqrt(MAX_PIXELS / (sw * sh));
      sw = Math.max(16, Math.round(sw * k));
      sh = Math.max(16, Math.round(sh * k));
    }
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = sw;
    srcCanvas.height = sh;
    const sctx = srcCanvas.getContext("2d");
    sctx.fillStyle = "#000";
    sctx.fillRect(0, 0, sw, sh);

    const srcBox = { x0: win.lon0, x1: win.lon1, y0: win.lat0, y1: win.lat1 };
    droppedOverlays = await fetchInto(
      sctx,
      srcBox,
      "4326",
      sw,
      sh,
      0,
      0,
      time,
      onProgress,
      srcHost,
    );
    reprojectFrom4326(srcCanvas, win, box, crs, ctx, dx, dy, w, h);
  } else {
    droppedOverlays = await fetchInto(ctx, box, crs, w, h, dx, dy, time, onProgress, srcHost);
  }

  if ($("ovOutline").checked) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, w, h);
    ctx.clip();
    ctx.translate(dx, dy);
    drawOutline(ctx, box, crs, w, h);
    ctx.restore();
  }

  return {
    w: outW,
    h: outH,
    imgW: w,
    imgH: h,
    natAspect,
    box,
    crs,
    bb,
    droppedOverlays,
    offCentre,
    letterboxed: spec.mode === "fixed" && spec.letterbox,
  };
}

function drawOutline(ctx, box, crs, w, h) {
  const half = worldHalf(crs);
  const sx = (x) => ((x - box.x0) / (box.x1 - box.x0)) * w;
  const sy = (y) => ((box.y1 - y) / (box.y1 - box.y0)) * h;

  ctx.lineWidth = Math.max(1.5, h / 650);
  ctx.strokeStyle = "#f0a048";
  ctx.lineJoin = "round";

  const use = subjectPolygons();
  // Draw each ring twice, once shifted a full world east, so dateline spans join up.
  for (const shift of [0, 2 * half]) {
    for (const rings of use)
      for (const ring of rings) {
        ctx.beginPath();
        ring.forEach(([lon, lat], i) => {
          const [px, py] = project(lon, lat, crs);
          const X = sx(px + shift),
            Y = sy(py);
          i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
        });
        ctx.closePath();
        ctx.stroke();
      }
  }
}

/* ═══════════════════════════════════════════════════════════
   Caption
   ═══════════════════════════════════════════════════════════ */

const CAPTION_DEFAULT = { night: "#f5efe6", day: "#121a24" };
let capColourTouched = false;
let crdColourTouched = false;

function cleanCaption(raw) {
  return String(raw || "")
    .replace(BIDI_AND_CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/* Heights of every solid strip, in pixels of the given frame. */
function stripHeights(spec, cap, credit) {
  const capBand = cap && cap.band ? Math.round(Math.round(spec.H * cap.frac) * 2.2) : 0;
  const creditPx = Math.max(10, Math.round(spec.H * 0.016));
  const crdBand = credit && credit.text && credit.band ? Math.round(creditPx * 2.4) : 0;
  return {
    capBand,
    crdBand,
    creditPx,
    top: cap && cap.atTop ? capBand : 0,
    bottom: (cap && !cap.atTop ? capBand : 0) + crdBand,
  };
}

function bandHeightFor(spec, cap, credit) {
  const h = stripHeights(spec, cap, credit);
  return h.top + h.bottom;
}

/*
  What size the imagery itself should be rendered at. A solid band inside a
  fixed frame steals height from the picture, so we render the picture at the
  reduced size rather than rendering full-size and scaling it down — that way
  the exported pixels are real, not resampled, and the frame stays exact.
*/
function imagerySpec(spec, cap, credit) {
  const bh = bandHeightFor(spec, cap, credit);
  if (spec.mode === "fixed" && bh > 0) {
    return { mode: "fixed", W: spec.W, H: Math.max(16, spec.H - bh), letterbox: spec.letterbox };
  }
  return spec;
}

function captionSpec() {
  const text = cleanCaption($("capText").value);
  if (!text) return null;
  return {
    text,
    atTop: $("capTop").getAttribute("aria-pressed") === "true",
    band: $("capBand").getAttribute("aria-pressed") === "true",
    colour: safeColour($("capColor").value, CAPTION_DEFAULT[isNight() ? "night" : "day"]),
    frac: clamp(+$("capSize").value, 18, 70) / 1000,
  };
}

/* Relative luminance, used to decide whether the scrim goes dark or light. */
function luminance(hex) {
  const m = HEX6.exec(String(hex));
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/* Shrink to fit, then truncate with an ellipsis if it still won't go. */
function fitCaption(ctx, text, maxW, basePx) {
  let px = basePx;
  const setFont = () => (ctx.font = `500 ${px}px "IBM Plex Sans", system-ui, sans-serif`);
  setFont();
  while (px > basePx * 0.55 && ctx.measureText(text).width > maxW) {
    px -= 1;
    setFont();
  }
  if (ctx.measureText(text).width > maxW) {
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    text = t + "…";
  }
  return { text, px };
}

/*
  Build a new canvas carrying the caption. The source imagery is reused rather
  than re-fetched, so a clean/captioned pair costs one set of requests.
  Band mode grows the canvas when the frame is free, and insets the imagery
  when the frame is fixed — 2400 × 1600 has to stay 2400 × 1600.
*/
/*
  Lay the caption and the projection credit onto the imagery.

  The credit always sits bottom right. When the caption is also along the
  bottom, the caption's usable width is narrowed symmetrically by the credit's
  width, so a centred caption can never reach across into it — the two never
  overlap regardless of how long the caption is.
*/
function composeText(src, cap, credit, fixedFrame) {
  const refH = fixedFrame ? fixedFrame.H : src.height;
  const spec = { H: refH };
  const strip = stripHeights(spec, cap, credit);

  const basePx = cap ? Math.max(8, Math.round(refH * cap.frac)) : 0;
  const capStrip = cap ? Math.round(basePx * 2.2) : 0; // band height, or scrim depth
  const creditPx = credit && credit.text ? strip.creditPx : 0;
  const margin = Math.round((creditPx || 10) * 0.9);

  const outW = fixedFrame ? fixedFrame.W : src.width;
  const outH = fixedFrame ? fixedFrame.H : src.height + strip.top + strip.bottom;

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");

  const scrimFor = (colour) => (luminance(colour) > 0.45 ? [10, 16, 23] : [242, 244, 246]);
  const capScrim = scrimFor(cap ? cap.colour : "#ffffff");
  const crdScrim = scrimFor(credit ? credit.colour : "#ffffff");

  const rgb = (c) => `rgb(${c.join(",")})`;
  const fade = (top, height, colour, downward) => {
    const g = downward
      ? ctx.createLinearGradient(0, top, 0, top + height)
      : ctx.createLinearGradient(0, top + height, 0, top);
    g.addColorStop(0, `rgba(${colour.join(",")},0.82)`);
    g.addColorStop(0.65, `rgba(${colour.join(",")},0.45)`);
    g.addColorStop(1, `rgba(${colour.join(",")},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, top, outW, height);
  };

  // Solid strips, bottom edge first: attribution band sits below a caption band.
  const crdBandTop = outH - strip.crdBand;
  const capBandBottomTop = crdBandTop - strip.capBand;

  if (strip.crdBand) {
    ctx.fillStyle = rgb(crdScrim);
    ctx.fillRect(0, crdBandTop, outW, strip.crdBand);
  }
  if (strip.capBand) {
    ctx.fillStyle = rgb(capScrim);
    ctx.fillRect(0, cap.atTop ? 0 : capBandBottomTop, outW, strip.capBand);
  }

  // The source was rendered at exactly the space left between the strips.
  ctx.drawImage(src, 0, strip.top, src.width, src.height);

  // Where the picture stops and the bottom strips begin.
  const imageFoot = outH - strip.bottom;

  // Measure the attribution: whether it can share a line depends on its width.
  let creditText = "",
    creditW = 0;
  if (creditPx) {
    ctx.font = `400 ${creditPx}px "IBM Plex Sans", system-ui, sans-serif`;
    const fittedCredit = fitCaption(ctx, credit.text, outW - margin * 3, creditPx);
    creditText = fittedCredit.text;
    ctx.font = `400 ${fittedCredit.px}px "IBM Plex Sans", system-ui, sans-serif`;
    creditW = ctx.measureText(creditText).width;
    strip.creditDrawPx = fittedCredit.px;
  }

  /*
    Caption and attribution collide only when both are overlays on the bottom
    edge. Narrowing the caption works while the attribution is short — a
    projection name — but a full licence string is far too wide for that, and
    the old width floor let them overlap. So: share the line when the reserved
    space genuinely leaves the caption half the frame, otherwise give the
    attribution its own line underneath.
  */
  const sameEdge = !!cap && !cap.atTop && creditPx > 0 && !credit.band;
  const reserve = sameEdge ? 2 * (creditW + margin * 2) : 0;
  const share = sameEdge && outW * 0.92 - reserve >= outW * 0.45;
  const creditRow = sameEdge && !share ? Math.round(creditPx * 1.9) : 0;

  if (cap) {
    const bandMode = !!cap.band;
    if (!bandMode) {
      const depth = capStrip + creditRow;
      fade(cap.atTop ? strip.top : imageFoot - depth, depth, capScrim, cap.atTop);
    }
    const budget = share ? Math.max(outW * 0.45, outW * 0.92 - reserve) : outW * 0.92;
    const fitted = fitCaption(ctx, cap.text, budget, basePx);
    ctx.font = `500 ${fitted.px}px "IBM Plex Sans", system-ui, sans-serif`;
    ctx.fillStyle = cap.colour;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cy = bandMode
      ? cap.atTop
        ? strip.capBand / 2
        : capBandBottomTop + strip.capBand / 2
      : cap.atTop
        ? strip.top + capStrip * 0.42
        : imageFoot - creditRow - capStrip * 0.42;
    ctx.fillText(fitted.text, outW / 2, cy);
  }

  if (creditPx) {
    if (!credit.band && !(cap && !cap.atTop && !cap.band)) {
      // Nothing else darkens this edge, so the attribution brings its own.
      fade(imageFoot - creditPx * 3, creditPx * 3, crdScrim, false);
    }
    ctx.font = `400 ${strip.creditDrawPx}px "IBM Plex Sans", system-ui, sans-serif`;
    ctx.fillStyle = credit.colour;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const cy = credit.band ? crdBandTop + strip.crdBand / 2 : imageFoot - creditPx * 1.05;
    ctx.globalAlpha = credit.band ? 1 : 0.92;
    ctx.fillText(creditText, outW - margin * 2, cy);
    ctx.globalAlpha = 1;
  }

  return out;
}

const PROJECTION_NAME = {
  3857: "Web Mercator projection",
  4326: "Equirectangular projection",
  eqearth: "Equal Earth projection",
};

/*
  CC BY-NC-SA requires the attribution to travel with the image, not merely to
  sit in the interface, so a non-commercial source forces the credit line on
  and prepends its attribution to the projection name.
*/
function creditSpec() {
  const attribution = currentLayer().attribution || "";
  // City mode never names the projection; a required licence credit still runs.
  const wantsProjection = !isCity() && $("showProj").checked;
  if (!wantsProjection && !attribution) return null;
  const parts = [attribution, wantsProjection ? own(PROJECTION_NAME, $("proj").value) : ""].filter(
    Boolean,
  );
  return {
    text: parts.join(" · "),
    band: $("crdBand").getAttribute("aria-pressed") === "true",
    colour: safeColour($("crdColor").value, CAPTION_DEFAULT[isNight() ? "night" : "day"]),
  };
}

/* Canvas silently substitutes a fallback face if the webfont isn't ready. */
async function ensureFont(px) {
  if (!document.fonts || !document.fonts.load) return;
  try {
    await document.fonts.load(`500 ${px}px "IBM Plex Sans"`);
  } catch (e) {
    /* fallback stack */
  }
}

/* ═══════════════════════════════════════════════════════════
   UI state
   ═══════════════════════════════════════════════════════════ */

const isCity = () => $("modeCity").getAttribute("aria-pressed") === "true";
const mainlandOnly = () => $("segMain").getAttribute("aria-pressed") === "true";

/*
  Countries and cities differ only in where their extent and outline come
  from. Everything downstream — framing, projection, captions, export —
  works through these three.
*/
function subjectBBox() {
  if (!current) return null;
  return isCity()
    ? cityBBox(current, !mainlandOnly(), { night: isNight(), res: currentLayer().res })
    : bboxFor(current, mainlandOnly());
}

function subjectPolygons() {
  if (!current) return [];
  if (!isCity()) {
    const keep = mainlandOnly() ? mainlandSet(current) : null;
    return current.polys.filter((p, i) => !keep || keep.has(i)).map((p) => p.rings);
  }
  const patches = urbanFor(current, !mainlandOnly());
  return patches ? patches.map((u) => u.rings) : [];
}

function subjectName() {
  if (!current) return "";
  return isCity() ? current.name : current.name;
}

/* A city's disambiguating line: "Springfield · Illinois · United States". */
function subjectQualifier() {
  if (!current || !isCity()) return "";
  return [current.region, current.country].filter(Boolean).join(" · ");
}
const isNight = () => $("segNight").getAttribute("aria-pressed") === "true";
const currentLayer = () => {
  const id = $("layer").value;
  return [...LAYERS.day, ...LAYERS.night].find((l) => l.id === id) || LAYERS.night[0];
};

/*
  Daytime opens on the most recent Sentinel-2 mosaic for either subject: at
  10 m it is the finest source available, and at country scale it is simply
  downsampled. Night has no such option and opens on Black Marble.
*/
function defaultLayerFor(list) {
  if (!isNight()) {
    const s2 = list.filter((l) => /^s2cloudless-\d{4}$/.test(l.id));
    if (s2.length) {
      return s2.reduce((best, l) =>
        parseInt(l.id.slice(-4), 10) > parseInt(best.id.slice(-4), 10) ? l : best,
      ).id;
    }
  }
  return list[0].id;
}

function fillLayers() {
  const list = isNight() ? LAYERS.night : LAYERS.day;
  const sel = $("layer");
  sel.replaceChildren(...list.map((l) => new Option(l.name, l.id)));
  sel.value = defaultLayerFor(list);
  syncDateField();
}

function syncDateField() {
  const l = currentLayer();
  $("dateField").hidden = !l.dated;
  if (l.dated) {
    const d = $("date");
    d.min = l.from || "1999-01-01";
    d.max = l.to || new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    if (!d.value || d.value < d.min || d.value > d.max) {
      d.value = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    }
  }
}

/*
  Resolve the frame controls into a render spec. Custom values are clamped
  hard: a stray digit here is an enormous canvas allocation.
*/
/*
  The tallest output at which every pixel is real data, given the current
  source and extent. For 500 m night imagery over a city this is small — which
  is the point: it shows what is actually there before any upscaling.
*/
function nativeHeight() {
  const bb = subjectBBox();
  if (!bb) return 1600;
  const heightM = (bb.lat1 - bb.lat0) * 110570 * Math.max(0.05, (+$("pad").value || 100) / 100);
  return clamp(Math.round(heightM / currentLayer().res), 64, 16000);
}

function frameSpec() {
  const v = $("frame").value;
  if (v === "native") return { mode: "fit", H: nativeHeight(), native: true };
  if (v.startsWith("fit:"))
    return { mode: "fit", H: clamp(parseInt(v.slice(4), 10) || 1600, 64, 16000) };

  let W, H;
  if (v === "custom") {
    W = clamp(Math.round(+$("customW").value) || 0, 64, 16000);
    H = clamp(Math.round(+$("customH").value) || 0, 64, 16000);
  } else {
    const [a, b] = v.split("x");
    W = clamp(parseInt(a, 10) || 2400, 64, 16000);
    H = clamp(parseInt(b, 10) || 1600, 64, 16000);
  }
  if (W * H > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (W * H));
    W = Math.max(64, Math.round(W * k));
    H = Math.max(64, Math.round(H * k));
  }
  return { mode: "fixed", W, H, letterbox: $("fillBars").getAttribute("aria-pressed") === "true" };
}

/* Scale a spec down to preview size, keeping proportions exact. */
function previewSpec(spec) {
  if (spec.mode === "fit") return { mode: "fit", H: PREVIEW_H };
  const k = Math.min(1, PREVIEW_H / spec.H);
  return {
    mode: "fixed",
    W: Math.max(16, Math.round(spec.W * k)),
    H: Math.max(16, Math.round(spec.H * k)),
    letterbox: spec.letterbox,
  };
}

const MB = (b) => (b / 1048576).toFixed(1) + " MB";

/*
  frac null means the total isn't known, and the bar sweeps rather than
  pretending to a percentage.
*/
function progress(label, frac, bytes) {
  const bar = $("bar");
  if (label === null) {
    bar.style.display = "none";
    bar.classList.remove("pending");
    $("loadLabel").textContent = "";
    return;
  }
  bar.style.display = "block";
  if (frac === null || frac === undefined) {
    bar.classList.add("pending");
    bar.firstElementChild.style.width = "";
  } else {
    bar.classList.remove("pending");
    bar.firstElementChild.style.width = clamp(frac * 100, 0, 100) + "%";
  }
  $("loadLabel").textContent = bytes ? `${label} · ${MB(bytes)}` : label;
}

/* Imagery fetches always know their total, and carry no label. */
function renderBar(frac) {
  const bar = $("bar");
  if (frac === null) {
    progress(null);
    return;
  }
  bar.classList.remove("pending");
  bar.style.display = "block";
  bar.firstElementChild.style.width = clamp(frac * 100, 0, 100) + "%";
  $("loadLabel").textContent = "";
}

/* ═══════════════════════════════════════════════════════════
   Preview pipeline
   ═══════════════════════════════════════════════════════════ */

let previewToken = 0;

async function updatePreview() {
  if (!current) return;
  const token = ++previewToken;
  renderBar(0);
  note("");

  try {
    const spec = frameSpec();
    const pspec = previewSpec(spec);
    const cap = captionSpec();
    const credit = creditSpec();
    const base = document.createElement("canvas");

    const r = await render(base, imagerySpec(pspec, cap, credit), (p) => {
      if (token === previewToken) renderBar(p);
    });
    if (token !== previewToken) return;

    if (cap) await ensureFont(Math.round(pspec.H * cap.frac));
    if (token !== previewToken) return;

    const shown =
      cap || (credit && credit.text)
        ? composeText(base, cap, credit, pspec.mode === "fixed" ? pspec : null)
        : base;

    const pv = $("preview");
    pv.width = shown.width;
    pv.height = shown.height;
    pv.getContext("2d").drawImage(shown, 0, 0);

    r.spec = spec;

    $("preview").style.display = "block";
    $("empty").style.display = "none";
    ["dlPng", "dlJpg", "copyUrl"].forEach((id) => ($(id).disabled = false));

    if (!corsState.tainted) {
      try {
        base.getContext("2d").getImageData(0, 0, 1, 1);
      } catch (e) {
        corsState.tainted = true;
        note(
          "This browser is blocking pixel access to NASA's servers, so in-page export is unavailable. Use “Copy image URL”, open it, and save the image directly — you'll get the full-size frame without the country outline.",
        );
      }
    }
    /*
      The picture is already on screen by this point, so nothing below may be
      allowed to report itself as a failure to fetch it. An error here is a
      fault in the annotations, not in the imagery.
    */
    try {
      showReadout(r);
      syncFraming();
      const messages = [];
      if (r.droppedOverlays && r.droppedOverlays.length) {
        const names = r.droppedOverlays.map((id) => own(OVERLAY_LABEL, id) || id).join(" and ");
        messages.push(
          `GIBS has no ${names} in this projection. Switch to Equirectangular or Equal Earth to use ${r.droppedOverlays.length > 1 ? "them" : "it"}.`,
        );
      }
      const detail = detailWarning();
      if (detail) messages.push(detail);
      if (messages.length) note(messages.join(" "));
    } catch (e) {
      note(
        "The image is fine, but the readout beside it failed: " +
          cleanName(e && e.message, 80) +
          ".",
        true,
      );
    }
  } catch (e) {
    if (token !== previewToken) return;
    /*
      This used to blame the imagery service for every failure, including
      faults in this page's own code. Say which it was, and name the error, so
      an unexpected one is reportable rather than misattributed.
    */
    const msg = cleanName(e && e.message, 90);
    const fetchFailed = /^HTTP |^http |Failed to fetch|NetworkError|load error/i.test(msg);
    note(
      fetchFailed
        ? `The imagery service didn't return a picture (${msg}). A dated layer may have nothing for that day — try another date, or a composite source that isn't date-based.`
        : `Couldn't build the image: ${msg}. This one is the page's fault rather than the imagery service's.`,
      true,
    );
  } finally {
    if (token === previewToken) renderBar(null);
  }
}

function showReadout(r) {
  const spec = r.spec || frameSpec();
  const cap = captionSpec();
  // This read a bare "credit", which exists nowhere: a ReferenceError on every
  // successful render, swallowed by the outer catch and reported as a failure
  // to fetch imagery.
  const credit = creditSpec();
  const ispec = imagerySpec(spec, cap, credit);
  const bandH = bandHeightFor(spec, cap, credit);
  const nat = r.natAspect;

  // Imagery pixels at export scale, and the finished canvas around them.
  // (Only the imagery's width matters for the scale shown below.)
  let imageryW, outW, outH;
  if (ispec.mode === "fixed") {
    if (ispec.letterbox) {
      imageryW = nat > ispec.W / ispec.H ? ispec.W : Math.round(ispec.H * nat);
    } else {
      imageryW = ispec.W;
    }
    outW = spec.W;
    outH = spec.H;
  } else {
    imageryW = Math.round(ispec.H * nat);
    outW = imageryW;
    outH = ispec.H + bandH;
  }

  // Ground metres per pixel across the imagery, at the centre of the frame.
  const midLat = (r.bb.lat0 + r.bb.lat1) / 2;
  const widthM =
    r.crs === "3857"
      ? (r.box.x1 - r.box.x0) * Math.cos((midLat * Math.PI) / 180)
      : (r.box.x1 - r.box.x0) * 111320 * Math.cos((midLat * Math.PI) / 180);
  const mpp = widthM / imageryW;
  const native = currentLayer().res;
  const factor = native / mpp;

  const fmt = (v, ax) => {
    const d = Math.abs(v).toFixed(1);
    return d + "°" + (ax === "lon" ? (v < 0 ? "W" : "E") : v < 0 ? "S" : "N");
  };
  const lon1 = r.bb.lon1 > 180 ? r.bb.lon1 - 360 : r.bb.lon1;

  // Built as nodes, not markup: the country name comes from a downloaded file
  // and must never be parsed as HTML.
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };

  const qual = subjectQualifier();
  const line1 = `${subjectName()}${qual ? " · " + qual : ""} · ${outW.toLocaleString()} × ${outH.toLocaleString()} px`;
  const line2 = `${fmt(r.bb.lon0, "lon")} – ${fmt(lon1, "lon")} · ${fmt(r.bb.lat0, "lat")} – ${fmt(r.bb.lat1, "lat")}`;

  const out = $("readout");
  out.replaceChildren(
    document.createTextNode(line1),
    el("br"),
    document.createTextNode(line2),
    el("br"),
    el("b", `${mpp.toFixed(0)} m/px`),
    document.createTextNode(" — "),
  );
  out.append(
    factor <= 1.15
      ? document.createTextNode("full native detail")
      : el("span", `${factor.toFixed(1)}× upscaled from ${native} m data`, "warn"),
  );

  if (r.offCentre) {
    out.append(
      el("br"),
      el(
        "span",
        "frame clipped at the projection's latitude limit — country is off-centre",
        "warn",
      ),
    );
  }
}

/* ═══════════════════════════════════════════════════════════
   Export
   ═══════════════════════════════════════════════════════════ */

function filename(ext, suffix) {
  const l = isNight() ? "night" : "day";
  const tail = (suffix ? "-" + suffix : "") + "." + ext;
  if ($("revealName").checked) {
    return current.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + l + tail;
  }
  let hash = 0;
  const seed = current.name + l + $("layer").value;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return "clue-" + hash.toString(36).slice(0, 6) + "-" + l + tail;
}

function saveCanvas(canvas, type, ext, suffix) {
  return new Promise((res, rej) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return rej(new Error("encode failed"));
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename(ext, suffix);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        res();
      },
      type,
      0.94,
    );
  });
}

async function exportImage(type, ext) {
  if (corsState.tainted) {
    note("In-page export is blocked in this browser. Use “Copy image URL” instead.", true);
    return;
  }
  const btn = ext === "png" ? $("dlPng") : $("dlJpg");
  const label = btn.textContent;
  btn.textContent = "Rendering…";
  btn.disabled = true;

  renderBar(0);

  try {
    const spec = frameSpec();
    const cap = captionSpec();
    const credit = creditSpec();
    const base = document.createElement("canvas");

    await render(base, imagerySpec(spec, cap, credit), (p) => renderBar(p));

    const hasText = cap || (credit && credit.text);

    if (!hasText) {
      await saveCanvas(base, type, ext);
    } else {
      await ensureFont(Math.round(spec.H * (cap ? cap.frac : 0.016)));
      const withText = composeText(base, cap, credit, spec.mode === "fixed" ? spec : null);
      const pair = $("pairExport").checked;
      await saveCanvas(withText, type, ext, pair ? "caption" : "");

      if (pair) {
        // Browsers commonly prompt before a page saves a second file.
        await new Promise((r) => setTimeout(r, 400));
        if (spec.mode === "fixed" && bandHeightFor(spec, cap, credit) > 0) {
          // A band inside a fixed frame shrank the picture, so a full-frame
          // clean copy is genuinely different imagery and needs its own pass.
          const clean = document.createElement("canvas");
          await render(clean, spec, (p) => renderBar(p));
          await saveCanvas(clean, type, ext);
        } else {
          await saveCanvas(base, type, ext);
        }
      }
    }
    note("");
  } catch (e) {
    note("Export failed while fetching imagery. Try a smaller frame, or a different date.", true);
  } finally {
    btn.textContent = label;
    btn.disabled = false;
    renderBar(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Country search
   ═══════════════════════════════════════════════════════════ */

let matches = [],
  cursor = 0;

const fmtPop = (p) =>
  p >= 1e6
    ? (p / 1e6).toFixed(1).replace(/\.0$/, "") + "M"
    : p >= 1e3
      ? Math.round(p / 1e3) + "k"
      : String(p || "");

/*
  "springfield, illinois" or "springfield, us" narrows by subdivision or
  country — the qualifier after the comma is matched against both.
*/
function search(q) {
  const raw = String(q || "");
  const [head, ...rest] = raw.split(",");
  const n = norm(head);
  const qual = norm(rest.join(" "));
  if (!n) return [];

  if (!isCity()) {
    const scored = [];
    for (const c of COUNTRIES) {
      const name = norm(c.name);
      const alts = (own(ALIASES, c.name) || []).map(norm);
      let score = -1;
      if (name === n || alts.includes(n)) score = 0;
      else if (name.startsWith(n) || alts.some((a) => a.startsWith(n))) score = 1;
      else if (name.includes(n) || alts.some((a) => a.includes(n))) score = 2;
      if (score >= 0) scored.push({ c, score });
    }
    return scored
      .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name))
      .slice(0, 8)
      .map((s) => s.c);
  }

  const scored = [];
  for (const c of CITIES) {
    const name = norm(c.name),
      ascii = norm(c.ascii);
    let score = -1;
    if (name === n || ascii === n) score = 0;
    else if (name.startsWith(n) || ascii.startsWith(n)) score = 1;
    else if (name.includes(n) || ascii.includes(n)) score = 2;
    if (score < 0) continue;

    if (qual) {
      const hay = norm(c.region + " " + c.country + " " + c.iso);
      const expanded = own(US_STATES, qual);
      if (!hay.includes(qual) && !(expanded && hay.includes(expanded))) continue;
    }
    scored.push({ c, score });
  }
  // Population breaks ties, so the Springfield people mean comes first.
  return scored
    .sort((a, b) => a.score - b.score || b.c.pop - a.c.pop)
    .slice(0, 10)
    .map((s) => s.c);
}

function renderResults() {
  const nodes = matches.map((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.i = String(i);
    if (i === cursor) b.className = "on";
    b.textContent = c.name; // never markup
    if (isCity()) {
      const bits = [c.region, c.country].filter(Boolean).join(" · ");
      const meta = document.createElement("small");
      meta.textContent = [bits, fmtPop(c.pop), c.wikidata ? "from Wikidata" : ""]
        .filter(Boolean)
        .join("  ");
      b.append(meta);
    }
    return b;
  });

  /*
    Offered even when the local list found something: a name can exist in
    Natural Earth and still be the wrong place. Touba is in the data as the
    Ivorian town, while the Senegalese city of a million people is not — so a
    hit is no evidence the search is finished.
  */
  if (isCity() && wikidataOffer) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.wd = "1";
    if (cursor === matches.length) b.className = "on";
    b.textContent = wikidataBusy
      ? `Searching Wikidata for “${wikidataOffer}”…`
      : matches.length
        ? `Also search Wikidata for “${wikidataOffer}”`
        : `Not here — search Wikidata for “${wikidataOffer}”`;
    const meta = document.createElement("small");
    meta.textContent = matches.length
      ? "Natural Earth leaves out many large places, so there may be more"
      : "Natural Earth carries about 7,300 places and leaves out many large ones";
    b.append(meta);
    nodes.push(b);
  }
  $("results").replaceChildren(...nodes);
}

let wikidataOffer = "",
  wikidataBusy = false;

/* The same settlement under two sources: same name, near enough the same spot. */
function sameCity(a, b) {
  if (norm(a.name) !== norm(b.name)) return false;
  return Math.abs(a.lat - b.lat) < 0.25 && Math.abs(a.lon - b.lon) < 0.25;
}

async function runWikidataSearch() {
  if (!wikidataOffer || wikidataBusy) return;
  wikidataBusy = true;
  renderResults();
  try {
    const found = await searchWikidataCities(wikidataOffer);
    const [, ...rest] = String($("q").value || "").split(",");
    const qual = norm(rest.join(" "));
    const kept = qual
      ? found.filter((c) => norm(c.region + " " + c.country + " " + c.iso).includes(qual))
      : found;

    // Keep what Natural Earth already gave, since those carry urban
    // footprints, and add only the places it did not have.
    const existing = matches.slice();
    const fresh = kept.filter((w) => !existing.some((c) => sameCity(c, w)));
    matches = existing.concat(fresh).slice(0, 14);
    cursor = existing.length < matches.length ? existing.length : 0;
    /*
      Four different outcomes hide behind "no new results", and which one it
      was decides what to try next: a different spelling, a different
      qualifier, or nothing at all.
    */
    const term = wikidataOffer;
    if (fresh.length) {
      note(
        `Wikidata added ${fresh.length} more ${fresh.length === 1 ? "place" : "places"} for “${term}”.`,
      );
    } else if (!found.length) {
      note(
        existing.length
          ? `Wikidata has no settlement called “${term}” either, so the ${existing.length === 1 ? "one above is" : "ones above are"} all there is.`
          : `Neither Natural Earth nor Wikidata has a settlement called “${term}”. A different spelling may find it.`,
        !existing.length,
      );
    } else if (!kept.length) {
      note(
        `Wikidata found ${found.length} ${found.length === 1 ? "place" : "places"} called “${term}”, but ${found.length === 1 ? "it is not" : "none of them is"} in “${rest.join(",").trim()}”. Dropping the part after the comma would show ${found.length === 1 ? "it" : "them"}.`,
        !existing.length,
      );
    } else {
      note(
        `Wikidata knows “${term}” but adds nothing new — everything it has is already listed above.`,
      );
    }
    wikidataOffer = "";
  } catch (e) {
    note("The Wikidata lookup failed: " + cleanName(e && e.message, 60) + ".", true);
  } finally {
    wikidataBusy = false;
    renderResults();
  }
}

/* Carrying 3× from Liechtenstein to Russia would be a surprise, and carrying
   a city's tight crop over to a whole country is worse. */
function resetFraming() {
  $("pad").value = "108";
  $("nudgeX").value = "0";
  $("nudgeY").value = "0";
}

function pick(c) {
  if (!c) return;
  resetFraming();
  current = c;
  $("q").value = c.name;
  matches = [];
  wikidataOffer = "";
  renderResults();
  // Say where a place came from when it did not come from the usual source.
  note(
    c.wikidata
      ? `“${c.name}” is not in Natural Earth; its position and population come from Wikidata (${c.wikidata}). No urban footprint is available, so the frame is sized from population.`
      : "",
  );
  syncFraming();
  updatePreview();
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

$("q").addEventListener("input", (e) => {
  matches = search(e.target.value);
  cursor = 0;
  const head = String(e.target.value || "")
    .split(",")[0]
    .trim();
  // Offered on any city search long enough to be meaningful, found or not.
  wikidataOffer = isCity() && head.length >= 3 && CITIES.length ? head : "";
  renderResults();
});
$("q").addEventListener("keydown", (e) => {
  // The Wikidata offer is a row like any other, so it has to be counted for
  // the arrow keys — and with no matches at all it is the only row there is.
  const rows = matches.length + (wikidataOffer ? 1 : 0);
  if (!rows) return;
  if (e.key === "ArrowDown") {
    cursor = (cursor + 1) % rows;
    renderResults();
    e.preventDefault();
  }
  if (e.key === "ArrowUp") {
    cursor = (cursor - 1 + rows) % rows;
    renderResults();
    e.preventDefault();
  }
  if (e.key === "Enter") {
    if (wikidataOffer && cursor === matches.length) runWikidataSearch();
    else if (matches[cursor]) pick(matches[cursor]);
    e.preventDefault();
  }
  if (e.key === "Escape") {
    matches = [];
    wikidataOffer = "";
    renderResults();
  }
});
$("results").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.wd === "1") runWikidataSearch();
  else pick(matches[+b.dataset.i]);
});

/*
  City mode hides what doesn't apply: Equal Earth is indistinguishable from
  Mercator across 40 km, and the GIBS reference vectors are generalised for
  global scale so they sit visibly wrong over a city.
*/
function syncModeUI() {
  const city = isCity();
  $("outlineLabel").textContent = city ? "Built-up area outline" : "Country outline";
  $("segMain").textContent = city ? "City core" : "Mainland";
  $("segFull").textContent = city ? "Metro area" : "Full extent";
  $("rowCoast").hidden = city;
  $("rowFeat").hidden = city;
  $("ovOutline").disabled = city && !URBAN.length;

  /*
    A city frame spans tens of kilometres, where the three projections differ
    by a fraction of a percent. Offering the choice would be noise, and naming
    the projection on the image would be noise on the image, so city mode is
    Mercator and says nothing about it.
  */
  $("eqearthOpt").hidden = city;
  $("projField").hidden = city;
  $("projCreditRow").hidden = city;
  if (city) $("proj").value = "3857";
  $("q").placeholder = city
    ? CITIES.length
      ? CITIES.length + " places — try “springfield, illinois”"
      : "Loading places…"
    : COUNTRIES.length
      ? COUNTRIES.length + " countries — start typing"
      : "Loading country outlines…";
}

async function setMode(city) {
  setSeg(city ? $("modeCity") : $("modeCountry"), city ? $("modeCountry") : $("modeCity"));
  current = null;
  matches = [];
  renderResults();
  $("q").value = "";

  // Metro reads better than the bare core at the resolutions available here;
  // countries still open on the mainland.
  if (city) setSeg($("segFull"), $("segMain"));
  else setSeg($("segMain"), $("segFull"));

  // A caption written for a country rarely suits a city, and vice versa.
  $("capText").value = "";
  syncCaptionUI();
  resetFraming();
  syncFraming();

  fillLayers();
  syncSourceUI();
  syncCaptionUI();
  $("preview").style.display = "none";
  $("empty").style.display = "block";
  $("readout").replaceChildren();
  ["dlPng", "dlJpg", "copyUrl"].forEach((id) => ($(id).disabled = true));
  syncModeUI();

  if (city && !CITIES.length) {
    $("q").disabled = true;
    note("");
    progress("Starting", null);
    try {
      await loadCities(progress);
      note(urbanFallbackNote);
      if (urbanFallbackNote) {
        $("ovOutline").checked = false;
      }
    } catch (e) {
      const detail = Array.isArray(e && e.tried) ? " Tried: " + e.tried.join("; ") + "." : "";
      note("Couldn't load the place data." + detail + " Switch back to City to retry.", true);
      $("q").disabled = false;
      return;
    } finally {
      progress(null);
      $("q").disabled = false;
    }
  }
  syncModeUI();
  $("q").focus();
}

$("modeCountry").addEventListener("click", () => setMode(false));
$("modeCity").addEventListener("click", () => setMode(true));

/*
  Sentinel-2 is CC BY-NC-SA, so its credit is not optional. Naming the
  projection is a separate choice and stays yours: the licence obliges the
  attribution, not the cartography note that used to ride along with it.
*/
function syncSourceUI() {
  const l = currentLayer();
  const nc = !!l.attribution;
  $("creditLabel").textContent = "Name the projection, bottom right";
  $("attribNotice").hidden = !nc;
  $("attribNotice").textContent = nc
    ? "This source is CC BY-NC-SA, so its credit is drawn on the image whether or not the projection is named."
    : "";
  if (nc)
    note(
      "Sentinel-2 cloudless is EOX's free fair-use tier: fine for making images, not for production traffic. The attribution is baked into the export.",
    );
}

$("segDay").addEventListener("click", () => {
  setSeg($("segDay"), $("segNight"));
  fillLayers();
  syncSourceUI();
  syncCaptionUI();
  applyCaptionDefault();
  updatePreview();
});
$("segNight").addEventListener("click", () => {
  setSeg($("segNight"), $("segDay"));
  fillLayers();
  syncSourceUI();
  syncCaptionUI();
  applyCaptionDefault();
  updatePreview();
});
$("segMain").addEventListener("click", () => {
  setSeg($("segMain"), $("segFull"));
  updatePreview();
});
$("segFull").addEventListener("click", () => {
  setSeg($("segFull"), $("segMain"));
  updatePreview();
});

$("layer").addEventListener("change", () => {
  syncDateField();
  syncSourceUI();
  syncCaptionUI();
  updatePreview();
});
$("date").addEventListener("change", updatePreview);
$("proj").addEventListener("change", updatePreview);

let padTimer;
function syncFraming() {
  const f = (+$("pad").value || 100) / 100;
  $("padOut").textContent = f.toFixed(2) + "×";
  const bb = subjectBBox();
  if (bb) {
    const km =
      (bb.lon1 - bb.lon0) * 111.32 * Math.cos((((bb.lat0 + bb.lat1) / 2) * Math.PI) / 180) * f;
    $("padOut2").textContent =
      km > 0 ? `${km >= 1000 ? Math.round(km / 10) * 10 : Math.round(km)} km across` : "";
  } else $("padOut2").textContent = "";

  const nx = +$("nudgeX").value || 0,
    ny = +$("nudgeY").value || 0;
  $("nudgeXOut").textContent =
    nx === 0 ? "centred" : `${Math.abs(nx)}% ${nx > 0 ? "east" : "west"}`;
  $("nudgeYOut").textContent =
    ny === 0 ? "centred" : `${Math.abs(ny)}% ${ny > 0 ? "north" : "south"}`;
}

/*
  Framing tighter than the source's own resolution does not reveal anything —
  the pixels are enlarged, not sharpened. Worth saying, since the remedy is
  usually a different layer rather than a different frame.
*/
function detailWarning() {
  const bb = subjectBBox();
  if (!bb) return "";
  const layer = currentLayer();
  if (!layer || !isNum(layer.res)) return "";
  const spec = frameSpec();
  const px = spec.mode === "fixed" ? spec.W : spec.W || 2400;
  if (!isNum(px) || px <= 0) return "";

  const f = Math.max(0.05, (+$("pad").value || 100) / 100);
  const widthM =
    (bb.lon1 - bb.lon0) * 111320 * Math.cos((((bb.lat0 + bb.lat1) / 2) * Math.PI) / 180) * f;
  if (!(widthM > 0)) return "";
  const asked = widthM / px;
  if (asked >= layer.res) return "";
  return (
    `This framing asks for about ${asked < 10 ? asked.toFixed(1) : Math.round(asked)} m per pixel, ` +
    `but ${layer.name.split(" — ")[0]} holds ${layer.res} m — the rest is enlargement, not detail. ` +
    `A finer source would show more.`
  );
}

$("pad").addEventListener("input", () => {
  syncFraming();
  clearTimeout(padTimer);
  padTimer = setTimeout(updatePreview, 280);
});
["nudgeX", "nudgeY"].forEach((id) =>
  $(id).addEventListener("input", () => {
    syncFraming();
    clearTimeout(padTimer);
    padTimer = setTimeout(updatePreview, 280);
  }),
);

["ovOutline", "ovCoast", "ovFeat"].forEach((id) => $(id).addEventListener("change", updatePreview));

/* ── frame ── */
function syncFrameUI() {
  const v = $("frame").value;
  $("customSize").hidden = v !== "custom";
  $("fillField").hidden = v.startsWith("fit:");
}
$("frame").addEventListener("change", () => {
  syncFrameUI();
  updatePreview();
});
$("fillImg").addEventListener("click", () => {
  setSeg($("fillImg"), $("fillBars"));
  updatePreview();
});
$("fillBars").addEventListener("click", () => {
  setSeg($("fillBars"), $("fillImg"));
  updatePreview();
});

let sizeTimer;
["customW", "customH"].forEach((id) =>
  $(id).addEventListener("input", () => {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(updatePreview, 400);
  }),
);

/* ── caption ── */
function syncCaptionUI() {
  const hasText = !!cleanCaption($("capText").value);
  const credit = $("showProj").checked || !!currentLayer().attribution;
  $("capTextOpts").hidden = !hasText;
  $("capColorField").hidden = !hasText;
  $("creditOpts").hidden = !credit;
  $("pairRow").hidden = !(hasText || credit);
}

let capTimer;
$("capText").addEventListener("input", () => {
  syncCaptionUI();
  clearTimeout(capTimer);
  capTimer = setTimeout(updatePreview, 350);
});
$("capTop").addEventListener("click", () => {
  setSeg($("capTop"), $("capBottom"));
  updatePreview();
});
$("capBottom").addEventListener("click", () => {
  setSeg($("capBottom"), $("capTop"));
  updatePreview();
});
$("capOverlay").addEventListener("click", () => {
  setSeg($("capOverlay"), $("capBand"));
  updatePreview();
});
$("capBand").addEventListener("click", () => {
  setSeg($("capBand"), $("capOverlay"));
  updatePreview();
});
$("capColor").addEventListener("input", () => {
  capColourTouched = true;
  updatePreview();
});
$("showProj").addEventListener("change", () => {
  syncCaptionUI();
  updatePreview();
});
$("crdOverlay").addEventListener("click", () => {
  setSeg($("crdOverlay"), $("crdBand"));
  updatePreview();
});
$("crdBand").addEventListener("click", () => {
  setSeg($("crdBand"), $("crdOverlay"));
  updatePreview();
});
$("crdColor").addEventListener("input", () => {
  crdColourTouched = true;
  updatePreview();
});
$("capSize").addEventListener("input", (e) => {
  $("capSizeOut").textContent = (+e.target.value / 10).toFixed(1) + "%";
  clearTimeout(capTimer);
  capTimer = setTimeout(updatePreview, 250);
});

/* Text colour follows the imagery unless the user has picked one. */
function applyCaptionDefault() {
  const preset = isNight() ? CAPTION_DEFAULT.night : CAPTION_DEFAULT.day;
  if (!capColourTouched) $("capColor").value = preset;
  if (!crdColourTouched) $("crdColor").value = preset;
}

$("dlPng").addEventListener("click", () => exportImage("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportImage("image/jpeg", "jpg"));

$("copyUrl").addEventListener("click", async () => {
  if (!current) return;
  const crs = $("proj").value;
  const bb = subjectBBox();
  if (!bb) return;
  const box = planeBox(bb, crs, +$("pad").value, nudgeX(), nudgeY());
  const spec = frameSpec();
  const H = spec.mode === "fixed" ? spec.H : spec.H;
  const W =
    spec.mode === "fixed" ? spec.W : Math.round((H * (box.x1 - box.x0)) / (box.y1 - box.y0));
  const url = wmsUrl(crs, box, W, H, activeLayerIds(), currentLayer().dated ? $("date").value : "");
  try {
    await navigator.clipboard.writeText(url);
    note(
      W > 4096
        ? `Image URL copied, but it asks for ${W} px across in one request — GIBS may refuse it. A smaller export height will help.`
        : "Image URL copied. Countries that cross the dateline get clipped in this single-request form.",
    );
  } catch (e) {
    window.prompt("Copy this URL:", url);
  }
});

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

fillLayers();
syncFrameUI();
syncSourceUI();
syncCaptionUI();
applyCaptionDefault();
syncModeUI();

fetch(TOPO_URL)
  .then((r) => {
    if (!r.ok) throw new Error("http " + r.status);
    return r.json();
  })
  .then((topo) => {
    COUNTRIES = topoToFeatures(topo, "countries")
      .map(buildCountry)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    $("q").disabled = false;
    syncModeUI();
    $("q").focus();
  })
  .catch(() => {
    $("q").placeholder = "Country outlines unavailable";
    note(
      "Couldn't reach the country outline data on jsDelivr. Check your connection and reload — the app needs it once at start-up to work out where each country is.",
      true,
    );
  });
