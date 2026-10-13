/**
 * Build the static site that GitHub Pages serves, in `_site/`:
 *
 *   _site/index.html        the overview, generated from apps/*\/index.html
 *   _site/index.css|js      its stylesheet and script (from site/)
 *   _site/apps/<slug>/      each app, copied as is
 *   _site/shared/           the modules the apps import
 *
 * There is no bundling or transpiling: the apps are plain ES modules and run
 * in the browser exactly as they are in the repository.
 *
 * Usage: npm run build
 */

import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { APPS_DIR, ROOT, SITE_DIR, collectApps, renderIndex } from "./apps.mjs";

const OUT = path.join(ROOT, "_site");

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await cp(APPS_DIR, path.join(OUT, "apps"), { recursive: true });
await cp(path.join(ROOT, "shared"), path.join(OUT, "shared"), { recursive: true });

// Everything in site/ except the template, which is rendered below.
for (const name of await readdir(SITE_DIR)) {
  if (name === "index.html") continue;
  await cp(path.join(SITE_DIR, name), path.join(OUT, name), { recursive: true });
}

const apps = await collectApps();
await writeFile(path.join(OUT, "index.html"), await renderIndex(apps));

// Tell GitHub Pages not to run Jekyll over the files.
await writeFile(path.join(OUT, ".nojekyll"), "");

const missing = apps.filter((a) => !a.description).map((a) => a.slug);
if (missing.length) {
  console.warn(`No <meta name="description"> in: ${missing.join(", ")}`);
}
console.log(`Built ${apps.length} apps into ${path.relative(ROOT, OUT)}/`);
