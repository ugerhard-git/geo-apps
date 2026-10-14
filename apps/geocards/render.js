/**
 * GeoCards — drawing cards, the sheet and single-card images, and loading
 * the fonts they use.
 */

/* ============================================================
 7. Canvas drawing
 ============================================================ */
export const SANS = "Archivo, system-ui, -apple-system, sans-serif";
export const SERIF = 'Fraunces, Georgia, "Times New Roman", serif';

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function fitFont(ctx, text, maxW, start, min, weight, family) {
  let size = start;
  while (size > min) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxW) break;
    size -= 1;
  }
  ctx.font = `${weight} ${size}px ${family}`;
  return size;
}

export function wrap(ctx, text, maxW, max) {
  const words = String(text).split(/\s+/),
    lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    const cut = lines.slice(0, max);
    cut[max - 1] = cut[max - 1].replace(/[,\s]+$/, "") + "…";
    return cut;
  }
  return lines;
}

export function drawCard(ctx, x, y, w, h, card, t) {
  const s = Math.min(w / 540, h / 460);

  /* Small text stops shrinking with the card. Past that point the card
   sheds detail instead of becoming unreadable. */
  const labelSize = Math.max(17, 25 * s);
  const uSize = Math.max(15, 21 * s);
  const noteSize = Math.max(14, 16 * s);
  const dense = s < 0.72;

  const pad = Math.max(18, 36 * s);
  const innerW = w - pad * 2;

  /* surface */
  ctx.save();
  roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 20 * s);
  if (t.surface) {
    ctx.fillStyle = t.surface;
    ctx.fill();
  }
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.strokeStyle = t.border;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  /* Measure every piece first, then centre the whole stack. Cards can be any
   shape once the sheet is filled edge to edge, and a label pinned to the top
   of a tall card drifts a long way from the number it belongs to. */
  ctx.font = `500 ${labelSize}px ${SANS}`;
  const labelLines = wrap(ctx, card.label, innerW, 2);

  const isEmpty = card.kind === "empty";
  const isProse = card.kind === "prose" && !isEmpty;
  ctx.font = `400 ${uSize}px ${SANS}`;
  const unitLines = !isEmpty && !isProse && card.unit ? wrap(ctx, card.unit, innerW, 2) : [];

  ctx.font = `400 ${noteSize}px ${SANS}`;
  const showDetail = !isEmpty && card.kind === "text" && card.detail && !dense;
  const detailLines = showDetail ? wrap(ctx, card.detail, innerW, 2) : [];

  const ruleGap = 14 * s,
    ruleH = Math.max(2, 2.5 * s),
    afterRule = 34 * s;
  const labelH = labelLines.length * labelSize * 1.22;
  const unitH = unitLines.length ? 12 * s + unitLines.length * uSize * 1.25 : 0;
  const detailH = detailLines.length ? 22 * s + detailLines.length * noteSize * 1.3 : 0;

  const fixed = labelH + ruleGap + ruleH + afterRule + unitH + detailH;
  const avail = h - pad * 2 - fixed;

  /* A prose card carries a paragraph instead of a headline figure, set at a
   size you read rather than one you look at. */
  let proseLines = [],
    proseSize = 0,
    proseStep = 0;
  if (isProse) {
    proseSize = Math.max(15, 25 * s);
    proseStep = proseSize * 1.42;
    const room = Math.max(2, Math.floor(avail / proseStep));
    ctx.font = `400 ${proseSize}px ${SANS}`;
    proseLines = wrap(ctx, card.big, innerW, Math.min(8, room));
  }

  const big = isEmpty ? "Not reported" : card.big;
  const vCap = isEmpty ? Math.max(20, 34 * s) : Math.min(112 * s, Math.max(24 * s, avail * 0.86));
  const vSize = isProse
    ? 0
    : fitFont(
        ctx,
        big,
        card.kind === "swatch" ? innerW * 0.62 : innerW,
        vCap,
        Math.min(22 * s, vCap),
        600,
        SERIF,
      );

  const total = fixed + (isProse ? proseLines.length * proseStep : vSize * 0.78);
  let cy = y + Math.max(pad, (h - total) / 2);

  /* label */
  ctx.font = `500 ${labelSize}px ${SANS}`;
  ctx.fillStyle = t.label;
  labelLines.forEach((l) => {
    ctx.fillText(l, x + pad, cy + labelSize * 0.86);
    cy += labelSize * 1.22;
  });

  /* hairline rule */
  cy += ruleGap;
  ctx.fillStyle = t.border;
  ctx.fillRect(x + pad, cy, 46 * s, ruleH);
  cy += ruleH + afterRule;

  if (isProse) {
    ctx.font = `400 ${proseSize}px ${SANS}`;
    ctx.fillStyle = t.value;
    proseLines.forEach((l) => {
      ctx.fillText(l, x + pad, cy + proseSize * 0.88);
      cy += proseStep;
    });
    ctx.restore();
    return;
  }

  /* value, with an optional colour chip in front of it */
  const vBase = cy + vSize * 0.78;
  let vx = x + pad;
  if (!isEmpty && card.kind === "swatch" && card.swatch) {
    const side = vSize * 0.78;
    ctx.save();
    roundRect(ctx, vx, vBase - side, side, side, side * 0.22);
    ctx.fillStyle = card.swatch;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.5 * s);
    ctx.strokeStyle = t.border;
    ctx.stroke();
    ctx.restore();
    vx += side + 18 * s;
  }
  ctx.font = `600 ${vSize}px ${SERIF}`;
  ctx.fillStyle = isEmpty ? t.label : t.value;
  ctx.fillText(big, vx, vBase);
  cy += vSize * 0.78;

  /* unit */
  if (unitLines.length) {
    cy += 12 * s;
    ctx.font = `400 ${uSize}px ${SANS}`;
    ctx.fillStyle = t.unit;
    unitLines.forEach((l) => {
      ctx.fillText(l, x + pad, cy + uSize * 0.86);
      cy += uSize * 1.25;
    });
  }

  /* a list too long to serve as the value */
  if (detailLines.length) {
    cy += 22 * s;
    ctx.font = `400 ${noteSize}px ${SANS}`;
    ctx.fillStyle = t.note;
    detailLines.forEach((l) => {
      ctx.fillText(l, x + pad, cy + noteSize * 0.86);
      cy += noteSize * 1.3;
    });
  }

  ctx.restore();
}

/* ============================================================
 8. Sheet + single-card rendering
 ============================================================ */
export const SHEET_W = 2400,
  SHEET_H = 1600,
  PAD = 60,
  GAP = 40;
export const CARD_RATIO = 540 / 460;

/* Every row spans the full width and the rows together span the full height,
 so no sheet space is left over. When the count will not divide evenly the
 remainder is spread across the top rows, which end up holding one extra
 card each and therefore slightly narrower cards. The arrangement chosen is
 the one whose worst-shaped card is closest to the natural card proportion,
 with a nudge towards rows that all hold the same number. */
export function layoutFor(n) {
  let best = null;
  for (let rows = 1; rows <= n; rows++) {
    const ch = (SHEET_H - PAD * 2 - GAP * (rows - 1)) / rows;
    if (ch < 70) continue;

    const base = Math.floor(n / rows),
      extra = n % rows;
    const counts = [];
    for (let r = 0; r < rows; r++) counts.push(base + (r < extra ? 1 : 0));
    if (counts[counts.length - 1] < 1) continue;

    const widths = counts.map((k) => (SHEET_W - PAD * 2 - GAP * (k - 1)) / k);
    if (widths.some((w) => w < 80)) continue;

    let worst = 0;
    widths.forEach((cw) => {
      worst = Math.max(worst, Math.abs(Math.log(cw / ch / CARD_RATIO)));
    });
    const uneven = new Set(counts).size - 1;
    const score = worst + uneven * 0.12;
    if (!best || score < best.score) best = { rows, counts, widths, ch, score };
  }
  if (!best) {
    const cw = (SHEET_W - PAD * 2 - GAP * (n - 1)) / n;
    best = { rows: 1, counts: [n], widths: [cw], ch: SHEET_H - PAD * 2 };
  }
  return best;
}

/* the smallest card any layout produces, used to warn about dense sheets */
export function smallestScale(n) {
  const L = layoutFor(n);
  return Math.min(...L.widths.map((w) => Math.min(w / 540, L.ch / 460)));
}

/**
 * Where each card sits on the sheet, in sheet pixels, row by row. Used both to
 * draw the sheet and to place the per-card buttons over the preview.
 *
 * @param {number} n number of cards
 * @returns {Array<{x: number, y: number, w: number, h: number}>}
 */
export function cardRects(n) {
  const L = layoutFor(n);
  const rects = [];
  L.counts.forEach((k, r) => {
    const cw = L.widths[r];
    const y = PAD + r * (L.ch + GAP);
    for (let c = 0; c < k; c++) rects.push({ x: PAD + c * (cw + GAP), y, w: cw, h: L.ch });
  });
  return rects;
}

export function renderSheet(cards, pal, transparent) {
  const cv = document.createElement("canvas");
  cv.width = SHEET_W;
  cv.height = SHEET_H;
  const ctx = cv.getContext("2d");
  if (!transparent) {
    ctx.fillStyle = pal.sheet;
    ctx.fillRect(0, 0, SHEET_W, SHEET_H);
  }
  cardRects(cards.length).forEach((r, i) => drawCard(ctx, r.x, r.y, r.w, r.h, cards[i], pal));
  return cv;
}

export const SINGLE_W = 1176,
  SINGLE_H = 1016,
  SINGLE_M = 48;

export function renderSingle(card, pal, transparent) {
  const cv = document.createElement("canvas");
  cv.width = SINGLE_W;
  cv.height = SINGLE_H;
  const ctx = cv.getContext("2d");
  if (!transparent) {
    ctx.fillStyle = pal.sheet;
    ctx.fillRect(0, 0, SINGLE_W, SINGLE_H);
  }
  drawCard(ctx, SINGLE_M, SINGLE_M, SINGLE_W - SINGLE_M * 2, SINGLE_H - SINGLE_M * 2, card, pal);
  return cv;
}

/* ============================================================
 9. Fonts
 ============================================================ */
export let fontsDone = false;
export async function ensureFonts() {
  if (fontsDone) return;
  try {
    await Promise.all([
      document.fonts.load("500 21px Archivo"),
      document.fonts.load("400 16px Archivo"),
      document.fonts.load("600 96px Fraunces"),
      document.fonts.load("500 34px Fraunces"),
    ]);
    await document.fonts.ready;
  } catch {
    /* draw with the fallback fonts rather than not at all */
  }
  fontsDone = true;
}
