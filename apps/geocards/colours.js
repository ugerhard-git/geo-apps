/**
 * GeoCards — card colours.
 */

/* ============================================================
 1. Card colours
 ============================================================ */
export const PRESETS = {
  light: { bg: "#FBF9F3", text: "#16232E" },
  dark: { bg: "#1D303E", text: "#F5F2E9" },
};

export function hex2rgb(h) {
  let s = String(h || "").replace("#", "");
  if (s.length === 3)
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  return [
    parseInt(s.slice(0, 2), 16) || 0,
    parseInt(s.slice(2, 4), 16) || 0,
    parseInt(s.slice(4, 6), 16) || 0,
  ];
}
export function rgba(h, a) {
  const [r, g, b] = hex2rgb(h);
  return `rgba(${r},${g},${b},${a})`;
}
export function mix(a, b, t) {
  const A = hex2rgb(a),
    B = hex2rgb(b);
  return (
    "#" +
    A.map((v, i) =>
      Math.round(v + (B[i] - v) * t)
        .toString(16)
        .padStart(2, "0"),
    ).join("")
  );
}

/* Everything on a card is the chosen text colour at a different strength,
 so the two pickers can never produce an unreadable combination. */
export function palette(bg, text, clearCard) {
  return {
    surface: clearCard ? null : bg,
    sheet: mix(bg, text, 0.06),
    value: text,
    unit: rgba(text, 0.8),
    label: rgba(text, 0.7),
    note: rgba(text, 0.7),
    border: rgba(text, 0.2),
  };
}
