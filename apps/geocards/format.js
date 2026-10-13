/**
 * GeoCards — formatting numbers and ranking a value among all countries.
 */

/* ============================================================
 2. Number + text formatting
 ============================================================ */
export const nf = (n, d = 0) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export function sig(v) {
  const a = Math.abs(v);
  if (a >= 100) return nf(v, 0);
  if (a >= 10) return nf(v, 1);
  return nf(v, 2);
}
export function scaleWord(n) {
  const a = Math.abs(n);
  if (a >= 1e12) return { v: n / 1e12, w: "trillion" };
  if (a >= 1e9) return { v: n / 1e9, w: "billion" };
  if (a >= 1e6) return { v: n / 1e6, w: "million" };
  if (a >= 1e4) return { v: n / 1e3, w: "thousand" };
  return { v: n, w: "" };
}
export const fmtPeople = (v) => {
  const s = scaleWord(v);
  return s.w ? { big: sig(s.v), unit: s.w + " people" } : { big: nf(v, 0), unit: "people" };
};
export const fmtCount = (v, u) => {
  const s = scaleWord(v);
  return s.w ? { big: sig(s.v), unit: s.w + " " + u } : { big: nf(v, 0), unit: u };
};
export const fmtMoney = (v) => {
  const s = scaleWord(v);
  return { big: "$" + sig(s.v), unit: (s.w ? s.w + " " : "") + "US$, current prices" };
};
export const fmtPerHead = (v) => ({ big: "$" + nf(v, 0), unit: "per person, current US$" });
export const fmtPct = (v, u) => ({ big: nf(v, 1) + "%", unit: u });
export const fmtNum = (v, u, d = 1) => ({ big: nf(v, d), unit: u });
export const fmtArea = (v) => ({ big: nf(v, 0), unit: "square kilometres" });

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"],
    v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ============================================================
 3. Ranking
 ============================================================ */
export function rankAmong(values, v) {
  if (!values || values.length < 2 || v == null || !isFinite(v)) return null;
  const sorted = [...values].sort((a, b) => b - a);
  const i = sorted.findIndex((x) => x <= v);
  const rank = i < 0 ? sorted.length : i + 1;
  const total = sorted.length;
  return { rank, total, pct: total > 1 ? (total - rank) / (total - 1) : 0.5 };
}
