/**
 * A small "Back to apps overview" link above each app's title. The built site
 * (`npm run build`) and the dev server both put the overview one level above
 * the apps, on whatever web server they run:
 *
 *   https://example.com/geo-apps/            the overview
 *   https://example.com/geo-apps/apps/<app>/ an app
 *
 * So the link appears on any web address of that shape. An app opened from a
 * file on disk gets no link: there, nothing says the overview is next to it.
 *
 * @module shared/back-link
 */

/**
 * The overview page's address, or `null` when this page isn't an app in the
 * site's layout.
 *
 * @param {{origin: string, pathname: string}} loc usually `window.location`
 * @returns {string | null}
 */
export function overviewUrl(loc) {
  // A page opened from disk has the origin "null".
  if (!/^https?:\/\//.test(loc.origin)) return null;
  // ".../<site>/apps/<app>/..." → ".../<site>/"
  const m = /^(\/(?:[^/]+\/)*)apps\/[^/]+\/(?:index\.html)?$/.exec(loc.pathname);
  return m ? loc.origin + m[1] : null;
}

/**
 * Add the link before everything else in the block that holds the page's
 * `<h1>`, so it sits at the top left of the app's own header and inherits its
 * text colour.
 */
export function addBackLink() {
  const href = overviewUrl(window.location);
  const h1 = document.querySelector("h1");
  if (!href || !h1 || !h1.parentElement) return;
  const a = document.createElement("a");
  a.href = href;
  a.className = "back-to-overview";
  a.textContent = "← Back to apps overview";
  // Styled from here (via the style object, which the apps' Content Security
  // Policy allows) so no app needs a stylesheet change.
  Object.assign(a.style, {
    display: "block",
    width: "fit-content",
    marginBottom: "10px",
    color: "inherit",
    opacity: "0.75",
    font: "500 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif",
    letterSpacing: "normal",
    textTransform: "none",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  });
  a.addEventListener("mouseenter", () => (a.style.opacity = "1"));
  a.addEventListener("mouseleave", () => (a.style.opacity = "0.75"));
  h1.parentElement.prepend(a);
}
