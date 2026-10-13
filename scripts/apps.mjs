/**
 * Discovering the apps and rendering the overview page.
 *
 * Every folder in `apps/` that contains an `index.html` is an app. Its card on
 * the overview page is built from that file's head:
 *
 * ```html
 * <title>Road sign sheets</title>
 * <meta name="description" content="Official road sign artwork, arranged on a quiz sheet.">
 * <meta name="geo-apps:tags" content="Commons, images">          (optional)
 * ```
 *
 * Nothing else needs registering: add a folder and it appears on the index.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const APPS_DIR = path.join(ROOT, "apps");
export const SITE_DIR = path.join(ROOT, "site");

/**
 * @typedef {object} AppInfo
 * @property {string} slug folder name, also the URL path
 * @property {string} title
 * @property {string} description
 * @property {string[]} tags
 */

/** @param {string} s */
const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** @param {string} s */
export const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * @param {string} html
 * @param {string} name
 */
function meta(html, name) {
  const tag = new RegExp(`<meta\\s+[^>]*name="${name}"[^>]*>`, "i").exec(html);
  if (!tag) return "";
  const content = /content="([^"]*)"/i.exec(tag[0]);
  return content ? decode(content[1]) : "";
}

/**
 * Read every app's title, description and tags.
 *
 * @returns {Promise<AppInfo[]>} sorted by title
 */
export async function collectApps() {
  const entries = await readdir(APPS_DIR, { withFileTypes: true });
  /** @type {AppInfo[]} */
  const apps = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(APPS_DIR, entry.name, "index.html");
    if (!existsSync(file)) continue;
    const html = await readFile(file, "utf8");
    const title = /<title>([\s\S]*?)<\/title>/i.exec(html);
    apps.push({
      slug: entry.name,
      title: title ? decode(title[1]) : entry.name,
      description: meta(html, "description"),
      tags: meta(html, "geo-apps:tags")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }
  return apps.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Render one app's card.
 *
 * @param {AppInfo} app
 */
function card(app) {
  const tags = app.tags.length
    ? `<ul class="tags">${app.tags.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`
    : "";
  return `
      <li class="app">
        <a href="apps/${encodeURIComponent(app.slug)}/">
          <h2>${escapeHtml(app.title)}</h2>
          <p>${escapeHtml(app.description || "")}</p>
          ${tags}
        </a>
      </li>`;
}

/**
 * Fill `site/index.html` with the app list.
 *
 * @param {AppInfo[]} apps
 * @returns {Promise<string>}
 */
export async function renderIndex(apps) {
  const template = await readFile(path.join(SITE_DIR, "index.html"), "utf8");
  return template
    .replace("<!-- APP_COUNT -->", String(apps.length))
    .replace("<!-- APPS -->", apps.map(card).join(""));
}
