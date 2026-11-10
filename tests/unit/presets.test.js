// Unit tests for the presets (shared/presets.js, shared/looks.js and each
// app's presets.js). Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { LOOKS, contrast } from "../../shared/looks.js";
import { pickOther, pickSpread } from "../../shared/presets.js";
import { HEIGHT_SCHEMES } from "../../apps/relief/config.js";
import { PALETTES, STATS } from "../../apps/statistics/config.js";
import { FIELDS } from "../../apps/factfile/config.js";

/**
 * Every app with presets: ids its page creates in code (so they aren't in its
 * HTML), the file with its examples, and whether it names countries the way
 * Natural Earth does instead of by ISO code.
 *
 * @type {Record<string, {dynamic?: string[], file?: string, names?: boolean, noCountry?: boolean}>}
 */
const APPS = {
  alphabets: {},
  "city-dots": {},
  climate: {},
  "cross-sections": {},
  currency: {},
  "day-length": {},
  endemics: {},
  "export-treemap": {},
  factfile: { dynamic: ["optFrom", ...FIELDS.map((f) => `f-${f.id}`)] },
  flagcolours: {},
  "geo-imagery": { names: true },
  geocards: {},
  keyboards: {},
  landmarks: {},
  letters: {},
  names: {},
  outlines: { names: true },
  "owid-chart-plotter": { file: "examples.js", noCountry: true },
  "place-endings": {},
  plates: {},
  relief: {},
  rivers: {},
  roadsigns: {},
  statistics: {},
  subdivisions: {},
};

test("every app has presets", () => {
  const apps = readdirSync("apps").filter((a) => existsSync(`apps/${a}/index.html`));
  assert.deepEqual(apps.sort(), Object.keys(APPS).sort());
});

test("every look is readable", () => {
  const ids = new Set();
  for (const l of LOOKS) {
    assert.ok(!ids.has(l.id), `${l.id} twice`);
    ids.add(l.id);
    for (const c of [l.paper, l.ink, l.accent]) assert.match(c, /^#[0-9a-f]{6}$/);
    assert.ok(contrast(l.ink, l.paper) >= 7, `${l.id}: ink on paper ${contrast(l.ink, l.paper)}`);
    assert.ok(contrast(l.accent, l.paper) >= 3, `${l.id}: accent on paper`);
    assert.ok(contrast(l.second, l.paper) >= 3, `${l.id}: second colour on paper`);
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

for (const [app, opts] of Object.entries(APPS)) {
  test(`${app}: every preset names controls the page has`, async () => {
    const html = readFileSync(`apps/${app}/index.html`, "utf8");
    const ids = new Set(
      [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).concat(opts.dynamic || []),
    );
    for (const id of ["preset", "rndCountry", "rndLook"]) assert.ok(ids.has(id), `#${id}`);
    assert.ok(html.includes("../../shared/presets.css"), "the presets stylesheet");
    const mod = await import(`../../apps/${app}/${opts.file || "presets.js"}`);
    const { EXAMPLES, lookToControls } = mod;
    const looks = mod.LOOKS || LOOKS;
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
      assert.ok(
        ex.name && looks.some((l) => l.id === ex.look),
        `${ex.id}: a name and a known look`,
      );
      if (opts.noCountry) assert.ok(ex.extra, `${ex.id}: what to show`);
      else if (opts.names) assert.ok(typeof ex.country === "string" && ex.country.length > 2);
      else assert.match(ex.country, /^[A-Z]{2}$/);
      check(ex, ex.id);
      for (const s of ex.extra?.stats || [])
        assert.ok(
          STATS.some((x) => x.id === s),
          `${ex.id}: no statistic ${s}`,
        );
    }
    for (const look of looks) check(lookToControls(look), `look ${look.id}`);
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
  const { MIN_RANDOM_AREA } = await import("../../apps/relief/presets.js");
  const { landArea } = await import("../../shared/world.js");
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

test("pickSpread takes one of each kind in turn", () => {
  const items = ["w1", "w2", "w3", "p1", "p2", "m1"];
  const kind = (/** @type {string} */ s) => s[0];
  assert.deepEqual(pickSpread(items, 4, kind), ["w1", "p1", "m1", "w2"]);
  assert.deepEqual(pickSpread(items, 10, kind).length, 6);
  assert.deepEqual(pickSpread(items, 2), ["w1", "w2"]);
  assert.deepEqual(pickSpread([], 3, kind), []);
});

test("widenThumb asks only for Wikimedia's standard widths", async () => {
  const { widenThumb, STANDARD_WIDTHS } = await import("../../shared/commons.js");
  const url =
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Sign.svg/330px-Sign.svg.png";
  assert.match(widenThumb(url, 5000, 1280) || "", /\/1280px-Sign\.svg\.png$/);
  // An original 600 px wide: 500, not 600, which Wikimedia would throttle.
  assert.match(widenThumb(url, 600, 1280) || "", /\/500px-Sign\.svg\.png$/);
  assert.equal(widenThumb(url, 300, 1280), null, "never narrower than what we have");
  for (const app of ["roadsigns", "plates", "currency", "landmarks", "endemics"]) {
    const { THUMB_W, FULL_W } = await import(`../../apps/${app}/config.js`);
    assert.ok(STANDARD_WIDTHS.includes(THUMB_W) && STANDARD_WIDTHS.includes(FULL_W), app);
  }
});
