// Unit tests for the pages on other sites listed on the overview
// (site/external.json). Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { collectApps, readExternal, readShots, renderIndex } from "../../scripts/apps.mjs";

test("every page on another site has a safe address, a description and a kind", () => {
  const kinds = ["images", "chart", "maps", "text", "cards"];
  for (const e of readExternal()) {
    assert.match(e.url, /^https:\/\//, e.slug);
    assert.ok(e.description.length > 40, `${e.slug}: description`);
    assert.ok(
      e.tags.some((t) => kinds.includes(t.toLowerCase())),
      `${e.slug}: one tag is a kind (${kinds.join(", ")})`,
    );
  }
});

test("the overview links each page on another site, marked, with its picture", async () => {
  const apps = await collectApps();
  const html = await renderIndex(apps);
  const shots = readShots();
  const external = readExternal();
  assert.ok(external.length >= 1);
  for (const e of external) {
    assert.ok(html.includes(`<a href="${e.url}">`), `${e.slug}: link`);
    assert.ok(!html.includes(`apps/${e.slug}/`), `${e.slug}: no local address`);
    assert.ok(shots[e.slug], `${e.slug}: has a picture`);
  }
  assert.equal((html.match(/<li class="app external"/g) || []).length, external.length);
  assert.equal((html.match(/Another site ↗/g) || []).length, external.length);
  assert.equal((html.match(/<li class="app/g) || []).length, apps.length + external.length);
});
