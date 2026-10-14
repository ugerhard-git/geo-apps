/**
 * A tiny local web server for working on the apps.
 *
 * The apps are ES modules, which browsers refuse to load from `file://`, so
 * open them through this server instead. It serves the repository as it is
 * (no build step) and renders the overview page on the fly, so a new app
 * shows up on http://localhost:8080/ as soon as its folder exists.
 *
 * Usage: npm run dev            (port 8080)
 *        PORT=3000 npm run dev
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ROOT, SITE_DIR, collectApps, renderIndex } from "./apps.mjs";

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "127.0.0.1";

/** @type {Record<string, string>} */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

/**
 * Map a URL path onto a file, the way GitHub Pages does.
 *
 * @param {string} urlPath
 * @returns {Promise<string | null>}
 */
async function resolveFile(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  // Never serve .git, other dot-folders or installed packages, even when the
  // server is reachable from other machines (HOST=0.0.0.0).
  if (clean.split(/[/\\]/).some((part) => part.startsWith(".") || part === "node_modules"))
    return null;
  // The overview's own assets live in site/; everything else in the repo root.
  for (const base of [SITE_DIR, ROOT]) {
    let file = path.join(base, clean);
    if (file !== base && !file.startsWith(base + path.sep)) return null; // stay inside the repository
    try {
      const s = await stat(file);
      if (s.isDirectory()) {
        file = path.join(file, "index.html");
        await stat(file);
      }
      return file;
    } catch {
      /* try the next base */
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  try {
    // A folder without a trailing slash would break relative imports.
    if (/^\/apps\/[^/]+$/.test(url.pathname)) {
      res.writeHead(301, { Location: url.pathname + "/" });
      res.end();
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await renderIndex(await collectApps());
      res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-store" });
      res.end(html);
      return;
    }
    const file = await resolveFile(url.pathname);
    if (!file) {
      res.writeHead(404, { "Content-Type": TYPES[".txt"] });
      res.end("Not found");
      return;
    }
    const type = TYPES[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500, { "Content-Type": TYPES[".txt"] });
    res.end(String(e));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Geo apps running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/`);
});
