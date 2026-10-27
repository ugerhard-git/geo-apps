// Unit tests for the overview pictures. Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { collectApps, readShots, renderIndex } from "../../scripts/apps.mjs";
import { RECIPES } from "../../scripts/screenshots/recipes.mjs";

test("every recipe is for an existing app", async () => {
  const slugs = new Set((await collectApps()).map((a) => a.slug));
  for (const slug of Object.keys(RECIPES)) assert.ok(slugs.has(slug), `${slug} is not an app`);
  for (const [slug, r] of Object.entries(RECIPES)) {
    assert.ok(r.alt && r.steps.length, `${slug} has steps and a description`);
  }
});

test("every listed picture exists, with a size and a description", () => {
  const shots = readShots();
  assert.ok(Object.keys(shots).length >= 10);
  for (const [slug, s] of Object.entries(shots)) {
    assert.ok(s.w > 0 && s.w <= 720 && s.h > 0 && s.h <= 480, `${slug} size`);
    assert.ok(s.alt, `${slug} description`);
    assert.match(s.v, /^[0-9a-f]{10}$/);
  }
});

test("the overview shows each picture with its size and description", async () => {
  const html = await renderIndex(await collectApps());
  for (const [slug, s] of Object.entries(readShots())) {
    assert.ok(
      html.includes(`src="shots/${slug}.webp?v=${s.v}" width="${s.w}" height="${s.h}"`),
      slug,
    );
  }
  assert.ok(!/alt="[^"]*[<>][^"]*"/.test(html), "descriptions are escaped");
});
