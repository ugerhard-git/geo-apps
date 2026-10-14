/**
 * Fitting a photo credit under its photograph, in full.
 *
 * A credit ("Author · CC BY-SA 4.0 · commons.wikimedia.org/…") must never be
 * cut off. It wraps onto several lines — between words, and inside long links
 * after a "/", "?", "&" or "=" — and only when that is not enough does the
 * font get smaller.
 *
 * Pure apart from the `measure` callback, so it can be unit-tested.
 *
 * @module shared/credits
 */

/**
 * Split text into pieces that may end a line: words (the space is dropped at
 * a break) and, inside long tokens such as links, runs ending in / ? & =.
 *
 * @param {string} text
 * @returns {Array<{text: string, space: boolean}>} `space`: a space follows
 */
function pieces(text) {
  /** @type {Array<{text: string, space: boolean}>} */
  const out = [];
  const words = text.split(/\s+/).filter(Boolean);
  words.forEach((w, wi) => {
    const parts = w.match(/[^/?&=]*[/?&=]|[^/?&=]+$/g) || [w];
    parts.forEach((p, pi) =>
      out.push({ text: p, space: pi === parts.length - 1 && wi < words.length - 1 }),
    );
  });
  return out;
}

/**
 * Wrap `text` into at most `maxLines` lines no wider than `maxW`.
 *
 * @param {string} text
 * @param {number} maxW
 * @param {number} maxLines
 * @param {(s: string) => number} measure width of a string at the current font
 * @returns {string[] | null} the lines, or null if it doesn't fit
 */
export function wrapCredit(text, maxW, maxLines, measure) {
  const lines = [];
  let line = "";
  let pendingSpace = false;
  for (const p of pieces(text)) {
    const candidate = line ? line + (pendingSpace ? " " : "") + p.text : p.text;
    if (!line || measure(candidate) <= maxW) {
      line = candidate;
    } else {
      lines.push(line);
      line = p.text;
    }
    if (measure(line) > maxW) return null; // a single piece is too wide
    pendingSpace = p.space;
  }
  if (line) lines.push(line);
  return lines.length <= maxLines ? lines : null;
}

/**
 * The largest font size, from `basePx` down to `minPx`, at which `text` fits
 * in `maxLines` lines of width `maxW`.
 *
 * @param {string} text
 * @param {number} maxW
 * @param {number} maxLines
 * @param {number} basePx
 * @param {number} minPx
 * @param {(s: string, px: number) => number} measureAt width of a string at a font size
 * @returns {{px: number, lines: string[]} | null}
 */
export function fitCredit(text, maxW, maxLines, basePx, minPx, measureAt) {
  for (let px = Math.round(basePx); px >= minPx; px--) {
    const lines = wrapCredit(text, maxW, maxLines, (s) => measureAt(s, px));
    if (lines) return { px, lines };
  }
  return null;
}
