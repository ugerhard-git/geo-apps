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
 *
 * Pages that live on another site but help with the same game are listed in
 * `site/external.json` (see `readExternal`). Their cards link there, in the
 * same tab like every card, and are marked "Another site".
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
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
 * @property {string} [url] set for a page on another site: where its card links
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
 * The pages on other sites, from `site/external.json`: a list of
 * `{id, title, url, description, tags}`. `id` names its picture in
 * `site/shots/` like an app's folder name. A broken entry stops the build
 * rather than being left out quietly, and only `https:` addresses are
 * accepted, so a card can't run script or point at an unsafe page.
 *
 * @returns {AppInfo[]}
 */
export function readExternal() {
  const file = path.join(SITE_DIR, "external.json");
  if (!existsSync(file)) return [];
  const list = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(list)) throw new Error("site/external.json: expected a list");
  return list.map((e, i) => {
    const where = `site/external.json, entry ${i + 1}`;
    const text = (/** @type {unknown} */ v) => typeof v === "string" && v.trim() !== "";
    if (!e || !/^[a-z0-9-]+$/.test(e.id)) throw new Error(`${where}: id must be a-z, 0-9 and -`);
    if (!text(e.title) || !text(e.description))
      throw new Error(`${where}: needs a title and a description`);
    let url;
    try {
      url = new URL(e.url);
    } catch {
      throw new Error(`${where}: url is not a web address`);
    }
    if (url.protocol !== "https:") throw new Error(`${where}: url must start with https://`);
    const tags = Array.isArray(e.tags) ? e.tags.filter(text).map((t) => t.trim()) : [];
    return {
      slug: e.id,
      title: e.title.trim(),
      description: e.description.trim(),
      tags,
      url: url.href,
    };
  });
}

/**
 * @typedef {object} Shot an app's picture, from site/shots/shots.json
 * @property {number} w width in pixels
 * @property {number} h height in pixels
 * @property {string} alt what it shows
 */

/**
 * The pictures taken by scripts/screenshots/take.mjs, by app. Only pictures
 * whose file exists are kept; a missing or broken list means no pictures.
 *
 * @returns {Record<string, Shot & {v: string}>} with `v`, a short hash of the
 *   file, so a new picture isn't hidden by a cached old one
 */
export function readShots() {
  const dir = path.join(SITE_DIR, "shots");
  /** @type {Record<string, Shot & {v: string}>} */
  const out = {};
  let list;
  try {
    list = JSON.parse(readFileSync(path.join(dir, "shots.json"), "utf8"));
  } catch {
    return out;
  }
  for (const [slug, shot] of Object.entries(list || {})) {
    const file = path.join(dir, `${slug}.webp`);
    if (!/^[a-z0-9-]+$/.test(slug) || !existsSync(file)) continue;
    const w = Number(shot?.w);
    const h = Number(shot?.h);
    if (!(w > 0 && h > 0)) continue;
    const v = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 10);
    out[slug] = { w, h, alt: String(shot.alt || ""), v };
  }
  return out;
}

/**
 * The picture frame at the top of a card (or the left of a list row). It is
 * always there, so the cards line up; empty until the app has a picture.
 *
 * @param {AppInfo} app
 * @param {(Shot & {v: string}) | undefined} shot
 */
function shotHtml(app, shot) {
  if (!shot) return `<span class="shot" aria-hidden="true"></span>`;
  const src = `shots/${encodeURIComponent(app.slug)}.webp?v=${shot.v}`;
  return `<span class="shot"><img src="${src}" width="${shot.w}" height="${shot.h}" alt="${escapeHtml(shot.alt)}" loading="lazy" decoding="async" /></span>`;
}

/**
 * @template T
 * @param {Record<string, T>} obj
 * @param {string} key
 * @returns {T | undefined}
 */
const own = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : undefined);

/** What kind of clue an app makes, from its tags; drives the card's colour. */
const KINDS = ["images", "chart", "maps", "text", "cards"];

/**
 * Render one app's card. `data-kind` colours it by the kind of clue; the
 * "API key" tag gets its own style, and a page on another site a mark of its own.
 *
 * @param {AppInfo} app
 * @param {Record<string, Shot & {v: string}>} shots
 */
function card(app, shots) {
  const kind = app.tags.find((t) => KINDS.includes(t.toLowerCase()))?.toLowerCase() || "other";
  const items = app.tags.map(
    (t) => `<li${/^api key$/i.test(t) ? ' class="key"' : ""}>${escapeHtml(t)}</li>`,
  );
  // A page on another site says so first, so nobody is surprised to leave.
  if (app.url) items.unshift(`<li class="ext">Another site ↗</li>`);
  const tags = items.length ? `<ul class="tags">${items.join("")}</ul>` : "";
  const href = app.url ? escapeHtml(app.url) : `apps/${encodeURIComponent(app.slug)}/`;
  return `
      <li class="app${app.url ? " external" : ""}" data-kind="${kind}">
        <a href="${href}">
          ${shotHtml(app, own(shots, app.slug))}
          <h2>${escapeHtml(app.title)}</h2>
          <p>${escapeHtml(app.description || "")}</p>
          ${tags}
        </a>
      </li>`;
}

/**
 * Fill `site/index.html` with the app list: the apps given, and the pages on
 * other sites (`readExternal`), in one list sorted by title.
 *
 * @param {AppInfo[]} apps
 * @returns {Promise<string>}
 */
export async function renderIndex(apps) {
  const template = await readFile(path.join(SITE_DIR, "index.html"), "utf8");
  const shots = readShots();
  const external = readExternal();
  const clash = external.find((e) => apps.some((a) => a.slug === e.slug));
  if (clash) throw new Error(`site/external.json: "${clash.slug}" is also an app's folder name`);
  const all = [...apps, ...external].sort((a, b) => a.title.localeCompare(b.title));
  return template
    .replace("<!-- APP_COUNT -->", String(all.length))
    .replace("<!-- APPS -->", all.map((app) => card(app, shots)).join(""));
}
