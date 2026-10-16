// Unit tests for the OWID chart plotter's ready-made charts. Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GROUPS,
  PRESETS,
  fold,
  parseTable,
  searchPresets,
} from "../../apps/owid-chart-plotter/presets.js";

test("every ready-made chart is complete", () => {
  assert.ok(PRESETS.length >= 50);
  const slugs = new Set();
  for (const p of PRESETS) {
    assert.match(p.slug, /^[a-z0-9-]+(\?[a-z0-9_=&-]+)?$/, `slug of ${p.name}`);
    assert.ok(!slugs.has(p.slug), `${p.slug} is listed twice`);
    slugs.add(p.slug);
    assert.ok(p.name && p.group && p.source, `${p.slug} has a name, group and source`);
    assert.match(p.years, /^[\d,]+( BCE)?–\d{4}$/, `years of ${p.slug}`);
  }
  assert.equal(GROUPS.length, 8);
});

test("parseTable reads groups and lines", () => {
  const list = parseTable("\n# A\nx | X | w | S | 1990–2020\n\n# B\ny | Y\n");
  assert.deepEqual(list, [
    { slug: "x", name: "X", group: "A", words: "w", source: "S", years: "1990–2020" },
    { slug: "y", name: "Y", group: "B", words: "", source: "", years: "" },
  ]);
});

test("fold makes text easy to compare", () => {
  assert.equal(fold("CO₂ émissions"), "co2 emissions");
  assert.equal(fold("R&D spending"), "r d spending");
});

test("searchPresets: names first, then search words; every word must match", () => {
  const names = (/** @type {string} */ q) => searchPresets(q).map((p) => p.name);
  assert.equal(names("").length, PRESETS.length, "nothing typed: everything");
  assert.equal(names("co2")[0], "CO₂ emissions per person");
  assert.deepEqual(names("chocolate"), ["Cocoa bean production"]);
  assert.equal(names("migration")[0], "Share of people born abroad");
  assert.ok(names("tour")[0] === "Tourist arrivals");
  assert.deepEqual(names("co2 share"), ["Share of global CO₂ emissions"]);
  assert.deepEqual(names("zzz"), []);
});
