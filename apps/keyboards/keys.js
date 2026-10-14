/**
 * Keyboard layouts — where each key sits, and what is printed on it.
 *
 * Pure (no DOM), so both can be unit-tested. Sizes are in key units: a
 * letter key is 1 × 1, a full row is 15 wide.
 */

/** @typedef {"iso" | "ansi" | "jis"} Shape */

/**
 * @typedef {object} KeyBox
 * @property {string} pos ISO position ("D01") for a character key, "" for the outer keys
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {Array<[number, number]>} [outline] an L-shaped key (the ISO Enter), as points
 */

/**
 * The keys of one shape, row by row: [position or "", width]. "" is an outer
 * key (Tab, Shift…), drawn blank. ISO and JIS Enter span two rows and are
 * added separately.
 *
 * @type {Record<Shape, Array<Array<[string, number]>>>}
 */
const ROWS = {
  iso: [
    [...row("E", 0, 12), ["", 2]],
    [["", 1.5], ...row("D", 1, 12)],
    [["", 1.75], ...row("C", 1, 12)],
    [["", 1.25], ...row("B", 0, 10), ["", 2.75]],
  ],
  ansi: [
    [...row("E", 0, 12), ["", 2]],
    [["", 1.5], ...row("D", 1, 12), ["C12", 1.5]],
    [["", 1.75], ...row("C", 1, 11), ["", 2.25]],
    [["", 2.25], ...row("B", 1, 10), ["", 2.75]],
  ],
  jis: [
    [...row("E", 0, 13), ["", 1]],
    [["", 1.5], ...row("D", 1, 12)],
    [["", 1.75], ...row("C", 1, 12)],
    [["", 2.25], ...row("B", 1, 11), ["", 1.75]],
  ],
};

/** The bottom row, the same for all three: Ctrl, Win, Alt, Space, AltGr, Win, Menu, Ctrl. */
const BOTTOM = [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25];

/**
 * @param {string} r row letter
 * @param {number} from
 * @param {number} to
 * @returns {Array<[string, number]>}
 */
function row(r, from, to) {
  /** @type {Array<[string, number]>} */
  const out = [];
  for (let i = from; i <= to; i++) out.push([r + String(i).padStart(2, "0"), 1]);
  return out;
}

/** The width of a full row. */
export const ROW_W = 15;

/**
 * Every key of a keyboard, in key units.
 *
 * @param {Shape} shape
 * @param {{bottom?: boolean, b11?: boolean}} [opts] include the bottom row (Ctrl, Space…);
 *   add the key right of the slash key (Brazil's ABNT2) to an ISO keyboard
 * @returns {{keys: KeyBox[], w: number, h: number}}
 */
export function keyboard(shape, { bottom = true, b11 = false } = {}) {
  /** @type {KeyBox[]} */
  const keys = [];
  const rows = ROWS[shape].slice();
  if (shape === "iso" && b11) rows[3] = [["", 1.25], ...row("B", 0, 11), ["", 1.75]];
  rows.forEach((r, y) => {
    let x = 0;
    for (const [pos, w] of r) {
      keys.push({ pos, x, y, w, h: 1 });
      x += w;
    }
  });
  if (shape !== "ansi") {
    // The tall Enter: 1.5 wide on the D row, 1.25 on the C row, flush right.
    const top = 15 - 1.5;
    const low = 15 - 1.25;
    keys.push({
      pos: "",
      x: top,
      y: 1,
      w: 1.5,
      h: 2,
      outline: [
        [top, 1],
        [15, 1],
        [15, 3],
        [low, 3],
        [low, 2],
        [top, 2],
      ],
    });
  }
  if (bottom) {
    let x = 0;
    for (const w of BOTTOM) {
      keys.push({ pos: "", x, y: 4, w, h: 1 });
      x += w;
    }
  }
  return { keys, w: ROW_W, h: bottom ? 5 : 4 };
}

/* ═══════════════════════════════════════════════════════════
   Legends
   ═══════════════════════════════════════════════════════════ */

/**
 * What one side of a keycap shows: one large character (a letter key: "Q"),
 * or a pair stacked shift-over-base ("!" over "1").
 *
 * @typedef {{kind: "letter", ch: string} | {kind: "pair", top: string, bottom: string}} Side
 */

/**
 * @typedef {object} Cap
 * @property {Side | null} left the main legend of a Latin keyboard, or the Latin one on a non-Latin keyboard
 * @property {Side | null} right the native legend of a non-Latin keyboard
 * @property {Side | null} altgr AltGr characters, bottom right (top: with Shift)
 * @property {boolean} [printed] the right side is an input method's characters (CJK), printed large
 */

/**
 * @typedef {object} LegendOptions
 * @property {boolean} shift show Shift characters
 * @property {boolean} altgr show AltGr characters
 * @property {boolean} latin show the Latin letters on non-Latin keyboards
 */

const LATIN = /\p{Script=Latin}/u;
const LETTER = /^[\p{L}\p{M}]/u;
const MARK = /^\p{M}/u;

/**
 * A legend as printed: a lone combining mark gets a dotted circle to sit on.
 *
 * @param {string} s
 */
export const printable = (s) => (MARK.test(s) ? "◌" + s : s);

/**
 * One side from a base and shift character: a letter key prints its capital
 * only; anything else prints both, shift on top.
 *
 * @param {string} base
 * @param {string} shift
 * @param {boolean} withShift
 * @returns {Side | null}
 */
export function side(base, shift, withShift) {
  if (!base && !shift) return null;
  const upper = base.toLocaleUpperCase();
  if (LETTER.test(base) && upper !== base && (shift === upper || !shift))
    return { kind: "letter", ch: upper };
  if (base && !shift) return { kind: "letter", ch: base };
  return withShift
    ? { kind: "pair", top: shift, bottom: base }
    : { kind: "pair", top: "", bottom: base };
}

/**
 * Whether a layout writes a non-Latin script: most of its letter keys do.
 *
 * @param {Record<string, string[]>} keys
 */
export function isNonLatin(keys) {
  let latin = 0;
  let other = 0;
  for (const [pos, k] of Object.entries(keys)) {
    if (!/^[DCB]/.test(pos)) continue;
    const ch = k[4] || k[0] || "";
    if (!LETTER.test(ch)) continue;
    if (LATIN.test(ch)) latin++;
    else other++;
  }
  return other > latin;
}

/**
 * What to print on the key at `pos`.
 *
 * @param {string} pos
 * @param {Record<string, string[]>} keys the layout's keys
 * @param {Record<string, string[]>} us the US layout's keys, for the Latin legends
 * @param {boolean} nonLatin from {@link isNonLatin}
 * @param {LegendOptions} opts
 * @returns {Cap}
 */
export function capFor(pos, keys, us, nonLatin, opts) {
  /** @type {Cap} */
  const blank = { left: null, right: null, altgr: null };
  // A key the layout doesn't define (JIS 半角/全角, say) stays blank.
  if (!keys[pos]) return blank;
  const k = keys[pos].map((s) => printable(s || ""));
  const [base = "", shift = "", ag = "", agShift = "", nat = "", natShift = ""] = k;
  /** @type {Cap} */
  const cap = { left: null, right: null, altgr: null };

  const altgr = () => {
    if (!opts.altgr || (!ag && !agShift)) return null;
    // A capital that just follows its small letter isn't worth printing.
    const top = opts.shift && agShift && agShift !== ag.toLocaleUpperCase() ? agShift : "";
    return /** @type {Side} */ ({ kind: "pair", top, bottom: ag });
  };

  if (nat || natShift) {
    // CJK: the Latin keyboard, plus the input method's characters.
    cap.left = opts.latin ? side(base, shift, opts.shift) : null;
    const top = opts.shift ? natShift : "";
    cap.right = top ? { kind: "pair", top, bottom: nat } : { kind: "letter", ch: nat };
    cap.printed = true;
    return cap;
  }

  const u = us[pos] || [];
  const sameAsUs = base === (u[0] || "") && shift === (u[1] || "");
  if (!nonLatin || sameAsUs || !u.length) {
    cap.left = side(base, shift, opts.shift);
    cap.altgr = altgr();
    return cap;
  }

  // A non-Latin key: the US legend small on the left, the native one large
  // on the right. A shift character that is just the Latin capital (Hebrew,
  // Greek…) is already there on the left.
  cap.left = opts.latin ? side(u[0] || "", u[1] || "", opts.shift) : null;
  const latinShift = shift && LATIN.test(shift) && shift === (u[1] || "");
  const right = side(base, latinShift ? "" : shift, opts.shift);
  // A digit printed on the left already needn't be repeated on the right.
  if (right && right.kind === "pair" && cap.left && right.bottom === (u[0] || "") && opts.latin)
    right.bottom = "";
  cap.right = right && (right.kind === "letter" || right.top || right.bottom) ? right : null;
  return cap;
}
