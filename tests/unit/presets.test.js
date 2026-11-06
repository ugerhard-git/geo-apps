// Unit tests for the presets (shared/presets.js, shared/looks.js and each
// app's presets.js). Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { LOOKS, contrast, lookById } from "../../shared/looks.js";
import { pickOther } from "../../shared/presets.js";
import { HEIGHT_SCHEMES } from "../../apps/relief/config.js";
import { PALETTES, STATS } from "../../apps/statistics/config.js";
import { FIELDS } from "../../apps/factfile/config.js";

/** The apps with presets, and ids their pages create in code. */
const APPS = {
  factfile: ["optFrom", ...FIELDS.map((f) => `f-${f.id}`)],
  relief: [],
  statistics: [],
  alphabets: [],
};

test("every look is readable", () => {
  const ids = new Set();
  for (const l of LOOKS) {
    assert.ok(!ids.has(l.id), `${l.id} twice`);
    ids.add(l.id);
    for (const c of [l.paper, l.ink, l.accent]) assert.match(c, /^#[0-9a-f]{6}$/);
    assert.ok(contrast(l.ink, l.paper) >= 7, `${l.id}: ink on paper ${contrast(l.ink, l.paper)}`);
    assert.ok(contrast(l.accent, l.paper) >= 3, `${l.id}: accent on paper`);
    assert.ok(
      HEIGHT_SCHEMES.some((s) => s.id === l.relief),
      `${l.id}: relief scheme`,
    );
    assert.ok(
      PALETTES.some((p) => p.id === l.chart),
      `${l.id}: chart palette`,
    );
  }
  assert.equal(contrast("#000000", "#ffffff").toFixed(0), "21");
});

for (const [app, dynamic] of Object.entries(APPS)) {
  test(`${app}: every preset names controls the page has`, async () => {
    const html = readFileSync(`apps/${app}/index.html`, "utf8");
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).concat(dynamic));
    for (const id of ["preset", "rndCountry", "rndLook"]) assert.ok(ids.has(id), `#${id}`);
    const { EXAMPLES, lookToControls } = await import(`../../apps/${app}/presets.js`);
    assert.ok(EXAMPLES.length >= 3, "a few examples");
    const seen = new Set();
    /** @param {{set?: object, press?: string[]}} c @param {string} where */
    const check = (c, where) => {
      for (const id of [...Object.keys(c.set || {}), ...(c.press || [])])
        assert.ok(ids.has(id), `${where}: no #${id} on the page`);
    };
    for (const ex of EXAMPLES) {
      assert.ok(!seen.has(ex.id), `${ex.id} twice`);
      seen.add(ex.id);
      assert.ok(ex.name && lookById(ex.look), `${ex.id}: a name and a known look`);
      assert.match(ex.country, /^[A-Z]{2}$/);
      check(ex, ex.id);
      for (const s of ex.extra?.stats || [])
        assert.ok(
          STATS.some((x) => x.id === s),
          `${ex.id}: no statistic ${s}`,
        );
    }
    for (const look of LOOKS) check(lookToControls(look), `look ${look.id}`);
  });
}

test("pickOther never repeats the current choice when there is another", () => {
  let i = 0;
  const seq = [0, 0.5, 0.99];
  const random = () => seq[i++ % seq.length];
  for (let n = 0; n < 9; n++) assert.notEqual(pickOther(["a", "b", "c"], "a", random), "a");
  assert.equal(pickOther(["a"], "a"), "a");
  assert.equal(pickOther([], null), undefined);
});

test("relief: land area tells a country from a speck", async () => {
  const { landArea, MIN_RANDOM_AREA } = await import("../../apps/relief/presets.js");
  /** @param {number} lon @param {number} lat @param {number} d */
  const square = (lon, lat, d) => [
    [
      [lon, lat],
      [lon + d, lat],
      [lon + d, lat + d],
      [lon, lat + d],
    ],
  ];
  assert.ok(Math.abs(landArea([square(0, 0, 1)]) - 1) < 0.01);
  assert.ok(landArea([square(10, 46, 2)]) > MIN_RANDOM_AREA, "Switzerland-sized");
  assert.ok(landArea([square(134, 7, 0.2)]) < MIN_RANDOM_AREA, "Palau-sized");
});
