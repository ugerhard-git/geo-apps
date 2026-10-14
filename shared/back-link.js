/**
 * A small "Back to apps overview" link above each app's title — but only on
 * the published site, where the folder layout is known:
 *
 *   https://ugerhard-git.github.io/geo-apps/            the overview
 *   https://ugerhard-git.github.io/geo-apps/apps/<app>/ an app
 *
 * Served anywhere else (the dev server, a copy on another host, a single
 * file), the link is left out, because the overview may not be where this
 * link would point.
 *
 * @module shared/back-link
 */

/** The only host the link appears on. */
export const PUBLISHED_ORIGIN = "https://ugerhard-git.github.io";

/**
 * The overview page's address, or `null` when this page isn't an app on the
 * published site.
 *
 * @param {{origin: string, pathname: string}} loc usually `window.location`
 * @returns {string | null}
 */
export function overviewUrl(loc) {
  if (loc.origin !== PUBLISHED_ORIGIN) return null;
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
