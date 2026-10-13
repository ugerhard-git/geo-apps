/**
 * Loading remote images so that they can be drawn on, and exported from, a
 * canvas.
 *
 * @module shared/images
 */

/**
 * Load an image element.
 *
 * @param {string} url
 * @param {boolean} anonymous request it with CORS (`crossOrigin = "anonymous"`)
 * @returns {Promise<HTMLImageElement>}
 */
export function rawLoad(url, anonymous) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (anonymous) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed"));
    img.src = url;
  });
}

/**
 * @typedef {object} ImageLoader
 * @property {(url: string) => Promise<HTMLImageElement>} load load (or reuse) an image
 * @property {Map<string, HTMLImageElement>} cache every image loaded so far, by URL
 * @property {boolean} tainted `true` once an image had to be loaded without
 *   CORS. Such an image still draws, but the canvas can no longer be exported.
 */

/**
 * Create a caching image loader that copes with servers that don't send CORS
 * headers.
 *
 * Wikimedia is expected to send `Access-Control-Allow-Origin`. If it doesn't,
 * an anonymous request fails outright, so the loader falls back to a plain
 * one: the sheet still draws, but the canvas becomes unreadable and export has
 * to stop. Check `loader.tainted` before exporting.
 *
 * @returns {ImageLoader}
 */
export function createImageLoader() {
  /** @type {"unknown" | "anonymous" | "none"} */
  let corsMode = "unknown";
  /** @type {Map<string, HTMLImageElement>} */
  const cache = new Map();

  const loader = {
    cache,
    tainted: false,
    /** @param {string} url */
    async load(url) {
      const hit = cache.get(url);
      if (hit) return hit;
      let img;
      if (corsMode === "none") {
        img = await rawLoad(url, false);
      } else {
        try {
          img = await rawLoad(url, true);
          corsMode = "anonymous";
        } catch (e) {
          if (corsMode === "anonymous") throw e; // CORS works; this is a genuine failure
          img = await rawLoad(url, false);
          corsMode = "none";
          loader.tainted = true;
        }
      }
      cache.set(url, img);
      return img;
    },
  };
  return loader;
}

/** Shown when a loader is tainted and export has been switched off. */
export const TAINTED_MESSAGE =
  "This browser wouldn't let the page read Wikimedia's images back, so export is unavailable. Serving the file over http://localhost rather than opening it directly usually fixes it.";
