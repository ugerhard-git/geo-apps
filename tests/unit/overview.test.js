// Unit tests for the overview page: the topics, the "New" mark and the app of
// the day (site/spotlight.js). Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TOPICS,
  checkTopicAndDate,
  collectApps,
  readExternal,
  renderIndex,
} from "../../scripts/apps.mjs";
import { NEW_DAYS, appOfTheDay, dayNumber, isNew } from "../../site/spotlight.js";

test("every app and every page on another site sits under one topic, and each topic has some", async () => {
  const all = [...(await collectApps()), ...readExternal()];
  const html = await renderIndex(await collectApps());
  for (const t of TOPICS) {
    assert.ok(
      all.some((a) => a.topic === t.id),
      `${t.id}: no app`,
    );
    assert.ok(html.includes(`<h2 id="topic-${t.id}">`), `${t.id}: heading`);
  }
  for (const a of all) assert.match(a.added, /^2\d{3}-\d{2}-\d{2}$/, a.slug);
  // Sections in the order of TOPICS.
  const order = [...html.matchAll(/id="topic-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    order,
    TOPICS.map((t) => t.id),
  );
});

test("the app of the day changes daily and gives every app a turn", () => {
  const slugs = ["alphabets", "climate", "relief", "rivers", "names"];
  const start = new Date(2026, 10, 10, 9);
  const seen = new Set();
  for (let d = 0; d < slugs.length; d++) {
    seen.add(appOfTheDay(slugs, new Date(2026, 10, 10 + d, 9)));
  }
  assert.equal(seen.size, slugs.length, "each app once in as many days");
  // The same all day, and not tied to the order of the list.
  assert.equal(appOfTheDay(slugs, start), appOfTheDay(slugs, new Date(2026, 10, 10, 23, 59)));
  assert.equal(appOfTheDay(slugs, start), appOfTheDay([...slugs].reverse(), start));
  assert.equal(appOfTheDay([], start), null);
});

test("an app is new for three weeks after it went live", () => {
  assert.equal(NEW_DAYS, 21);
  const day = (/** @type {number} */ d) => new Date(2026, 10, d, 12);
  assert.ok(isNew("2026-11-10", day(10)));
  assert.ok(isNew("2026-11-10", day(30)));
  assert.ok(!isNew("2026-11-10", new Date(2026, 11, 1, 12)));
  assert.ok(!isNew("2026-11-10", day(9)), "not before it went live");
  assert.ok(!isNew("", day(10)));
  assert.ok(!isNew("10.11.2026", day(10)));
  assert.equal(dayNumber(new Date(1970, 0, 2, 0, 30)), 1);
});

test("a wrong topic or date stops the build", () => {
  assert.doesNotThrow(() => checkTopicAndDate("x", "land", "2026-11-10"));
  assert.throws(() => checkTopicAndDate("x", "space", "2026-11-10"), /topic must be one of/);
  assert.throws(() => checkTopicAndDate("x", undefined, "2026-11-10"), /topic must be one of/);
  assert.throws(() => checkTopicAndDate("x", "land", "soon"), /must be a date/);
  assert.throws(() => checkTopicAndDate("x", "land", "2026-13-45"), /must be a date/);
});
