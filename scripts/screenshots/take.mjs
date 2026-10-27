#!/usr/bin/env node
/**
 * Takes the pictures shown on the overview page: each app's finished sheet,
 * made with the country and settings in recipes.mjs.
 *
 *   node scripts/screenshots/take.mjs              every app
 *   node scripts/screenshots/take.mjs relief names only these
 *
 * It starts the dev server, opens each app in Chromium (from Playwright), runs
 * its recipe, waits for the sheet, and saves `site/shots/<app>.webp`, at most
 * 720 × 480 pixels. `site/shots/shots.json` records each picture's size and
 * description, which the overview reads. An app whose recipe fails keeps its
 * old picture (or none) and is listed at the end; the run then exits with 1.
 *
 * The apps fetch live data, so this needs the internet. It runs on GitHub
 * (Actions → "App screenshots" → Run workflow), which opens a pull request
 * with the new pictures. Set PW_CHROMIUM_PATH to use a Chromium of your own.
 */

// The functions passed to page.evaluate run in the browser, not in Node.
/* global document, Image, HTMLCanvasElement */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { ROOT, SITE_DIR } from "../apps.mjs";
import { RECIPES } from "./recipes.mjs";

const OUT = path.join(SITE_DIR, "shots");
const MANIFEST = path.join(OUT, "shots.json");
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
/** The largest picture, in pixels. */
const MAX_W = 720;
const MAX_H = 480;

/**
 * @typedef {import("./recipes.mjs").Recipe} Recipe
 * @typedef {import("./recipes.mjs").Step} Step
 * @typedef {import("@playwright/test").Page} Page
 */

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one step of a recipe.
 *
 * @param {Page} page
 * @param {Step} step
 */
async function runStep(page, step) {
  if (step.country) {
    // The country search is disabled until the app has loaded its list.
    await page.waitForFunction(() => !document.querySelector("#country")?.disabled, null, {
      timeout: 60_000,
    });
    await page.fill("#country", step.country);
    const exact = page.locator("#countryResults button", { hasText: step.country }).first();
    await exact.waitFor({ timeout: 20_000 });
    await exact.click();
  } else if (step.select) {
    await page.selectOption(step.select[0], step.select[1]);
  } else if (step.check) {
    await page.check(step.check);
  } else if (step.uncheck) {
    await page.uncheck(step.uncheck);
  } else if (step.fill) {
    await page.fill(step.fill[0], step.fill[1]);
  } else if (step.hide) {
    await page.addStyleTag({ content: `${step.hide} { visibility: hidden !important; }` });
  } else if (step.click) {
    const all = page.locator(step.click);
    await all.first().waitFor({ timeout: 120_000 });
    const n = Math.min(step.count || 1, await all.count());
    for (let i = 0; i < n; i++) {
      await all.nth(i).click();
      await sleep(300);
    }
  }
  if (step.wait) await sleep(step.wait);
}

/**
 * Wait until the page has stopped loading: no progress bar running, the
 * sheet shown, and no network traffic for a moment.
 *
 * @param {Page} page
 * @param {string} capture
 */
async function settle(page, capture) {
  await page.locator(capture).waitFor({ state: "visible", timeout: 90_000 });
  await page
    .waitForFunction(() => !document.querySelector(".bar.pending"), null, {
      timeout: 120_000,
    })
    .catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  // Fonts and photos are drawn a moment after they arrive.
  await sleep(2500);
}

/**
 * The captured element as a WebP data URL, scaled down to fit MAX_W × MAX_H.
 * A canvas is read at its full size; anything else is photographed first.
 *
 * @param {Page} page
 * @param {string} capture
 * @returns {Promise<{data: string, w: number, h: number}>}
 */
async function grab(page, capture) {
  const el = page.locator(capture).first();
  const isCanvas = await el.evaluate((n) => n instanceof HTMLCanvasElement);
  const png = isCanvas
    ? await el.evaluate((n) => /** @type {HTMLCanvasElement} */ (n).toDataURL("image/png"))
    : "data:image/png;base64," + (await el.screenshot({ type: "png" })).toString("base64");
  return page.evaluate(
    async ({ png, maxW, maxH }) => {
      const img = new Image();
      img.src = png;
      await img.decode();
      const k = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const w = Math.round(img.naturalWidth * k);
      const h = Math.round(img.naturalHeight * k);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      return { data: c.toDataURL("image/webp", 0.85), w, h };
    },
    { png, maxW: MAX_W, maxH: MAX_H },
  );
}

/**
 * Make one app's picture.
 *
 * @param {import("@playwright/test").Browser} browser
 * @param {string} slug
 * @param {Recipe} recipe
 */
async function shoot(browser, slug, recipe) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  try {
    await page.goto(`${BASE}/apps/${slug}/`, { waitUntil: "load" });
    for (const step of recipe.steps) await runStep(page, step);
    const capture = recipe.capture || "#sheet";
    await settle(page, capture);
    const { data, w, h } = await grab(page, capture);
    if (!data.startsWith("data:image/webp;base64,")) throw new Error("no WebP from the browser");
    await writeFile(path.join(OUT, `${slug}.webp`), Buffer.from(data.split(",")[1], "base64"));
    return { w, h };
  } finally {
    await page.close();
  }
}

const only = process.argv.slice(2);
const slugs = Object.keys(RECIPES).filter((s) => !only.length || only.includes(s));
await mkdir(OUT, { recursive: true });
/** @type {Record<string, {w: number, h: number, alt: string}>} */
const manifest = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, "utf8")) : {};

const server = spawn(process.execPath, ["scripts/dev-server.mjs"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
  stdio: "ignore",
});
await sleep(1500);
const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);

/** @type {string[]} */
const failed = [];
try {
  for (const slug of slugs) {
    try {
      const { w, h } = await shoot(browser, slug, RECIPES[slug]);
      manifest[slug] = { w, h, alt: RECIPES[slug].alt };
      console.log(`ok   ${slug} (${w} × ${h})`);
    } catch (err) {
      failed.push(slug);
      console.log(`FAIL ${slug}: ${/** @type {Error} */ (err).message.split("\n")[0]}`);
    }
  }
} finally {
  await browser.close();
  server.kill();
}

// Sorted, one app per line, so a diff shows what changed.
const lines = Object.keys(manifest)
  .sort()
  .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(manifest[k])}`);
await writeFile(MANIFEST, `{\n${lines.join(",\n")}\n}\n`);

if (failed.length) {
  console.log(`\nNo new picture for: ${failed.join(", ")}`);
  process.exitCode = 1;
}
