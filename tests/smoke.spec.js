// Smoke test: every app, and the overview page, loads without an uncaught
// error. Data APIs are blocked, so this also checks that each app copes when
// its data source is unreachable — and it never touches live services.
// Libraries and fonts from CDNs are still allowed through.

import { expect, test } from "@playwright/test";
import { collectApps } from "../scripts/apps.mjs";

const apps = await collectApps();
const ALLOWED_HOSTS = [
  "127.0.0.1",
  "cdn.jsdelivr.net",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

/** @param {import("@playwright/test").Page} page */
async function open(page, url) {
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    ALLOWED_HOSTS.includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  await page.goto(url);
  await page.waitForLoadState("networkidle").catch(() => {});
  return errors;
}

test("the overview lists every app", async ({ page }) => {
  const errors = await open(page, "/");
  await expect(page.locator(".app")).toHaveCount(apps.length);
  await expect(page.locator(".key")).not.toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const app of apps) {
  test(`${app.slug} loads without errors`, async ({ page }) => {
    const errors = await open(page, `/apps/${app.slug}/`);
    await expect(page).toHaveTitle(app.title);
    expect(errors).toEqual([]);
  });
}
