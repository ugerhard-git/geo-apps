/**
 * Alphabets — loading the Google Fonts each script needs, on demand.
 */

const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
/** @type {Set<string>} */
let loadedFamilies = new Set();

/**
 * Make sure every family in `families` is loaded before the canvas uses it.
 * The stylesheet link is rewritten to cover every family asked for so far.
 *
 * @param {Iterable<string>} families e.g. "Noto Sans Arabic"
 */
export async function ensureFonts(families) {
  const wanted = new Set([...loadedFamilies, ...families]);
  if (wanted.size !== loadedFamilies.size) {
    loadedFamilies = wanted;
    const q = [...wanted]
      .map((f) => "family=" + encodeURIComponent(f).replace(/%20/g, "+") + ":wght@400;600")
      .join("&");
    fontLink.href = "https://fonts.googleapis.com/css2?" + q + "&display=swap";
    if (!fontLink.parentNode) document.head.appendChild(fontLink);
  }
  if (!document.fonts || !document.fonts.load) return;
  // Canvas silently substitutes a fallback if the face isn't ready, so wait.
  await Promise.all(
    [...families].flatMap((f) => [
      document.fonts.load(`400 100px "${f}"`).catch(() => {}),
      document.fonts.load(`600 100px "${f}"`).catch(() => {}),
    ]),
  );
}
