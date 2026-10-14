// Unit tests for the pure modules inside the apps. Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { casePair, parseUnicodeSet, scriptOf } from "../../apps/alphabets/unicode.js";
import { decodeCities, isFormatError } from "../../apps/city-dots/cities.js";
import { extentOf, pickDots, radiusFor } from "../../apps/city-dots/dots.js";
import { fitCredit, wrapCredit } from "../../apps/endemics/credits.js";
import { justifiedRows } from "../../apps/endemics/layout.js";
import { joinChoices } from "../../apps/export-treemap/countries.js";
import { cubeFor, toProducts } from "../../apps/export-treemap/oec.js";
import { squarify } from "../../apps/export-treemap/treemap.js";
import { quantise } from "../../apps/flagcolours/measure.js";
import { buildData, csvCell, safeName, valueAt } from "../../apps/owid-chart-plotter/data.js";
import { splitSlug } from "../../apps/owid-chart-plotter/owid.js";
import { Region, clipLines, clipPath } from "../../apps/rivers/clip.js";
import { parseLakes, parseRivers } from "../../apps/rivers/data.js";
import { rankWidth } from "../../apps/rivers/render.js";
import { applyAffix, detectAffix, stripAffix } from "../../apps/subdivisions/names.js";

test("alphabets: CLDR unicode sets, scripts and case pairs", () => {
  assert.deepEqual(parseUnicodeSet("[a b c {ch} d-f]"), ["a", "b", "c", "ch", "d", "e", "f"]);
  assert.equal(scriptOf("Ελλάδα"), "Greek");
  assert.equal(scriptOf("abc"), "Latin");
  assert.deepEqual(casePair("i", "tr"), { lower: "i", upper: "İ" });
  assert.equal(casePair("ß", "de").upper, null);
});

test("export treemap: squarify fills the box exactly, without overlap", () => {
  const values = [6, 6, 4, 3, 2, 2, 1];
  const tiles = squarify(
    values.map((value) => ({ value })),
    0,
    0,
    6,
    4,
  );
  assert.equal(tiles.length, values.length);
  const area = tiles.reduce((s, t) => s + t.w * t.h, 0);
  assert.ok(Math.abs(area - 24) < 1e-9);
  for (const t of tiles) {
    assert.ok(Math.abs(t.w * t.h - t.n.node.value) < 1e-9, "area matches value");
    assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= 6 + 1e-9 && t.y + t.h <= 4 + 1e-9);
  }
  assert.deepEqual(squarify([], 0, 0, 10, 10), []);
});

test("export treemap: OEC cubes and product parsing", () => {
  assert.equal(cubeFor(2023), "trade_i_baci_a_22");
  assert.equal(cubeFor(2016), "trade_i_baci_a_12");
  assert.equal(cubeFor(1995), "trade_i_baci_a_92");
  const products = toProducts({
    data: [
      { "HS4 ID": "160000", HS4: "Cars", "Trade Value": 5 },
      { "HS4 ID": "99", HS4: "?", "Trade Value": 0 },
    ],
  });
  assert.deepEqual(products, [{ name: "Cars", section: 16, value: 5 }]);
});

test("flag colours: anti-aliased shades fold into the main colours", () => {
  const counts = new Map([
    [0xff0000, 600],
    [0xfe0101, 10],
    [0x0000ff, 380],
    [0x808080, 10],
  ]);
  const slices = quantise(
    { counts, opaque: 1000, clear: 0, width: 10, height: 100 },
    { fold: true, threshold: 0.02, maxSlices: 10 },
  );
  assert.deepEqual(
    slices.map((s) => [s.colour, s.share]),
    [
      ["#ff0000", 0.62],
      ["#0000ff", 0.38],
    ],
  );
});

test("subdivisions: a shared prefix or suffix is found and dropped", () => {
  const states = ["Bavaria State", "Hesse State", "Saxony State", "Berlin State"];
  const affix = detectAffix(states);
  assert.equal(affix?.kind, "suffix");
  assert.equal(affix?.text, "State");
  assert.equal(stripAffix("Bavaria State", affix), "Bavaria");
  assert.deepEqual(applyAffix(states, affix).slice(0, 2), ["Bavaria", "Hesse"]);
  assert.equal(
    detectAffix(["Prefecture of A", "Prefecture of B", "Prefecture of C"])?.kind,
    "prefix",
  );
});

test("OWID plotter: parsing a grapher CSV", () => {
  const csv =
    "﻿Entity,Code,Year,Life expectancy (years),Region\r\n" +
    "Kenya,KEN,2000,52.1,Africa\r\nKenya,KEN,2010,60.5,Africa\r\nChile,CHL,2010,79,South America\r\n";
  const d = buildData(csv, "test");
  assert.equal(d.label, "Life expectancy");
  assert.equal(d.unit, "years");
  assert.deepEqual(d.entities, ["Chile", "Kenya"]);
  assert.deepEqual(d.years, [2000, 2010]);
  assert.equal(valueAt(d, "Kenya", 2005), 52.1, "falls back to the latest earlier year");
  assert.equal(valueAt(d, "Chile", 2005), null);
  assert.throws(() => buildData("Entity,Year\n", "x"), /no data rows/);
  // OWID's dimension suffixes are cut off the label.
  const dims = buildData("Entity,Year,Share - Sex: all - Age: 15+\nA,2000,1\n", "x");
  assert.equal(dims.fullLabel, "Share");
});

test("OWID plotter: slugs, file names and CSV cells are made safe", () => {
  assert.deepEqual(splitSlug("https://ourworldindata.org/grapher/energy-mix?country=x#Coal (%)"), {
    display: "energy-mix?country=x#Coal (%)",
    slug: "energy-mix?country=x",
    colHint: "Coal (%)",
    base: "energy-mix",
  });
  assert.equal(safeName("../-rf?x#y"), "rf");
  assert.equal(csvCell("=1+1"), '"\'=1+1"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
});

test("export treemap: CLDR names are joined to OEC ids by ISO alpha-3", () => {
  const oec = [
    { id: "eudeu", name: "Germany" },
    { id: "eucze", name: "Czech Republic" },
    { id: "xxabc", name: "Somewhere OEC-only" },
    { id: "bad id!", name: "Dropped" },
  ];
  const territories = [
    { code: "DE", name: "Germany", alts: [] },
    { code: "CZ", name: "Czechia", alts: [] },
    { code: "FR", name: "France", alts: [] },
  ];
  const alpha3 = new Map([
    ["DE", "DEU"],
    ["CZ", "CZE"],
    ["FR", "FRA"],
  ]);
  const choices = joinChoices(oec, territories, alpha3);
  assert.deepEqual(
    choices.map((c) => [c.code, c.name, c.oecId]),
    [
      ["CZ", "Czechia", "eucze"],
      ["DE", "Germany", "eudeu"],
      ["ABC", "Somewhere OEC-only", "xxabc"],
    ],
  );
  // The OEC's own name and the alpha-3 code still find Czechia.
  assert.ok(choices[0].alts.includes("Czech Republic") && choices[0].alts.includes("CZE"));
  // Without CLDR, the OEC list is used as it is.
  assert.equal(joinChoices(oec, null, null).length, 3);
});

test("OWID plotter: each entity keeps its Code column", () => {
  const d = buildData(
    "Entity,Code,Year,V\nGermany,DEU,2000,1\nWorld,OWID_WRL,2000,2\nX,,2000,3\n",
    "t",
  );
  assert.equal(d.codes.get("Germany"), "DEU");
  assert.equal(d.codes.get("World"), "OWID_WRL");
  assert.equal(d.codes.has("X"), false);
});

test("endemics: justifiedRows keeps every photo's shape and fits the box", () => {
  const box = { x: 10, y: 20, w: 1000, h: 600 };
  const aspects = [1.5, 0.75, 1.33, 1, 2, 0.66, 1.5];
  const gap = 10;
  const placed = justifiedRows(aspects, box, gap, 30);
  assert.equal(placed.length, aspects.length);
  placed.forEach((p, i) => {
    // no cropping: drawn shape = the photo's shape
    assert.ok(Math.abs(p.w / p.h - aspects[i]) < 1e-9);
    // inside the box
    assert.ok(p.x >= box.x - 1e-6 && p.x + p.w <= box.x + box.w + 1e-6);
    assert.ok(p.y >= box.y - 1e-6 && p.y + p.h + 30 <= box.y + box.h + 1e-6);
  });
  // photos in a row share its height, and rows don't overlap
  const rows = [...new Set(placed.map((p) => p.y))].sort((a, b) => a - b);
  for (const y of rows) {
    const r = placed.filter((p) => p.y === y);
    assert.equal(new Set(r.map((p) => p.h.toFixed(6))).size, 1);
  }
  // order is kept: reading left to right, top to bottom
  const order = placed
    .map((p, i) => ({ i, y: p.y, x: p.x }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((p) => p.i);
  assert.deepEqual(
    order,
    aspects.map((_, i) => i),
  );
  assert.deepEqual(justifiedRows([], box, gap, 0), []);
});

test("endemics: credits wrap in full, breaking links after / ? & =", () => {
  const measure = (/** @type {string} */ t) => t.length; // 1 unit per character
  const credit = "Ann Lee · CC BY-SA 4.0 · commons.wikimedia.org/w/index.php?curid=798034";
  const lines = wrapCredit(credit, 24, 4, measure);
  assert.ok(lines);
  assert.ok(
    lines.every((l) => l.length <= 24),
    JSON.stringify(lines),
  );
  // nothing lost: the lines put back together give the whole credit
  assert.equal(lines.join(" ").replace(/\/ /g, "/").replace(/\? /g, "?"), credit);
  assert.equal(wrapCredit(credit, 24, 2, measure), null, "too many lines needed");
  assert.deepEqual(wrapCredit("short", 24, 1, measure), ["short"]);
});

test("endemics: fitCredit shrinks the font only when wrapping isn't enough", () => {
  // width grows with font size: px/10 units per character
  const measureAt = (/** @type {string} */ t, /** @type {number} */ px) => (t.length * px) / 10;
  const credit = "Ann Lee · CC BY 4.0 · commons.wikimedia.org/x";
  const wide = fitCredit(credit, 200, 1, 20, 8, measureAt);
  assert.equal(wide?.px, 20, "fits on one line at full size");
  const narrow = fitCredit(credit, 40, 3, 20, 8, measureAt);
  assert.ok(narrow && narrow.px < 20 && narrow.lines.length <= 3);
  assert.equal(fitCredit(credit, 5, 1, 20, 8, measureAt), null);
});

/* ── City dots ───────────────────────────────────────────── */

/** A tiny Protocol Buffers writer, enough to build test files. */
function pbf() {
  /** @type {number[]} */
  const bytes = [];
  const varint = (/** @type {number} */ v) => {
    while (v >= 128) {
      bytes.push((v % 128) | 128);
      v = Math.floor(v / 128);
    }
    bytes.push(v);
  };
  return {
    bytes,
    varint,
    key: (/** @type {number} */ tag, /** @type {number} */ wire) => varint(tag * 8 + wire),
    svarint: (/** @type {number} */ v) => varint(v < 0 ? -v * 2 - 1 : v * 2),
  };
}

/**
 * One city record, length-prefixed, in all-the-cities' layout.
 *
 * @param {{country: string, feature?: string, pop?: number, dLon: number, dLat: number, extra?: boolean}} c
 */
function cityRecord(c) {
  const m = pbf();
  const str = (/** @type {number} */ tag, /** @type {string} */ s) => {
    m.key(tag, 2);
    const utf8 = Buffer.from(s, "utf8");
    m.varint(utf8.length);
    for (const b of utf8) m.bytes.push(b);
  };
  m.key(1, 0);
  m.svarint(12345);
  str(2, "Zürich");
  str(3, c.country);
  if (c.extra) (m.key(15, 5), m.bytes.push(1, 2, 3, 4)); // an unknown fixed32 field
  str(7, c.feature || "PPL");
  if (c.pop) (m.key(9, 0), m.varint(c.pop));
  m.key(10, 0);
  m.svarint(c.dLon);
  m.key(11, 0);
  m.svarint(c.dLat);
  const out = pbf();
  out.varint(m.bytes.length);
  return [...out.bytes, ...m.bytes];
}

test("city dots: the city list decodes, with cumulative coordinates", () => {
  const buf = Uint8Array.from([
    ...cityRecord({ country: "CH", pop: 400000, dLon: 854000, dLat: 4737000 }),
    ...cityRecord({
      country: "CH",
      feature: "PPLC",
      pop: 130000,
      dLon: -110000,
      dLat: -42000,
      extra: true,
    }),
    ...cityRecord({ country: "CH", feature: "PPLX", pop: 9e6, dLon: 1, dLat: 1 }), // a district: skipped
    ...cityRecord({ country: "c", pop: 5, dLon: 0, dLat: 0 }), // a bad country code: skipped
    ...cityRecord({ country: "LI", pop: 5000, dLon: 100000, dLat: 0 }),
  ]);
  const byCountry = decodeCities(buf);
  assert.deepEqual([...byCountry.keys()].sort(), ["CH", "LI"]);
  const ch = /** @type {any[]} */ (byCountry.get("CH"));
  assert.equal(ch.length, 2);
  assert.deepEqual(ch[0], { lon: 8.54, lat: 47.37, pop: 400000, capital: false });
  assert.deepEqual(ch[1], { lon: 7.44, lat: 46.95, pop: 130000, capital: true });
  // The skipped records still moved the running coordinates.
  const li = /** @type {any[]} */ (byCountry.get("LI"))[0];
  assert.ok(Math.abs(li.lon - 8.44001) < 1e-9 && Math.abs(li.lat - 46.95001) < 1e-9);
});

test("city dots: a damaged city list is rejected, not trusted", () => {
  const good = cityRecord({ country: "CH", pop: 1, dLon: 0, dLat: 0 });
  const bad = [
    good.slice(0, good.length - 3), // cut short
    [200, 1, ...good.slice(1)], // a record longer than the file
    [3, 0x0b, 0, 0], // wire type 3
    [11, ...Array(11).fill(0xff)], // a runaway varint
  ];
  for (const bytes of bad)
    assert.throws(
      () => decodeCities(Uint8Array.from(bytes)),
      (e) => isFormatError(e),
    );
  assert.equal(decodeCities(new Uint8Array(0)).size, 0);
});

test("city dots: picking dots keeps to the subject and can add the capital", () => {
  const cities = [
    { lon: 10, lat: 50, pop: 900, capital: false },
    { lon: 100, lat: 0, pop: 800, capital: false }, // far away: outside the boxes
    { lon: 11, lat: 51, pop: 700, capital: false },
    { lon: 12, lat: 52, pop: 100, capital: true },
  ];
  const r = Math.PI / 180;
  const box = { x0: 9 * r, x1: 13 * r, y0: 0.9, y1: 1.1 };
  const plain = pickDots(cities, 2, [box], 0.3);
  assert.deepEqual(
    plain.map((d) => d.pop),
    [900, 700],
  );
  const withCap = pickDots(cities, 2, [box], 0.3, true);
  assert.deepEqual(
    withCap.map((d) => d.pop),
    [900, 100],
  );
  // No outline: nothing to keep to.
  assert.equal(pickDots(cities, 10, [], 0.3).length, 4);
  // East of the antimeridian, a city is tried shifted round to join the outline.
  const far = pickDots(
    [{ lon: -175, lat: 65, pop: 1, capital: false }],
    5,
    [{ x0: 3.1, x1: 3.3, y0: 1.5, y1: 1.6 }],
    0.3,
  );
  assert.equal(far.length, 1);
  assert.ok(far[0].x > Math.PI);
});

test("city dots: dot areas follow population, with a floor", () => {
  assert.equal(radiusFor(100, 100, 40, false), 40);
  assert.ok(Math.abs(radiusFor(25, 100, 40, false) - 20) < 1e-9);
  assert.equal(radiusFor(0, 100, 40, false), 40 * 0.14);
  assert.equal(radiusFor(1, 100, 40, true), radiusFor(100, 100, 40, true));
  const ext = extentOf([], [{ x: 1, y: 1, pop: 1, capital: false }]);
  assert.ok(ext && ext.x1 > ext.x0 && ext.y1 > ext.y0);
  assert.equal(extentOf([], []), null);
});

/* ── Rivers ──────────────────────────────────────────────── */

/** A 10° square country with a 2° lake-hole in the middle, in plane units. */
function squareCountry() {
  const d = Math.PI / 180;
  const sq = (/** @type {number} */ a, /** @type {number} */ b) => [
    [a * d, a * d],
    [b * d, a * d],
    [b * d, b * d],
    [a * d, b * d],
  ];
  return new Region([[sq(0, 10), sq(4, 6)]], 6);
}

test("rivers: the region knows inside, holes and the border strip", () => {
  const r = squareCountry();
  const d = Math.PI / 180;
  assert.equal(r.inside(2 * d, 2 * d), true);
  assert.equal(r.inside(5 * d, 5 * d), false); // the hole
  assert.equal(r.inside(12 * d, 2 * d), false);
  // 6 km is about 0.054°; 0.03° outside is near, 0.2° is not.
  assert.equal(r.near(10.03 * d, 5 * d), true);
  assert.equal(r.near(10.2 * d, 5 * d), false);
});

test("rivers: lines are cut to the country, border runs kept only when long", () => {
  const r = squareCountry();
  const d = Math.PI / 180;
  const path = (/** @type {number[][]} */ pts) =>
    Float64Array.from(pts.flatMap(([x, y]) => [x * d, y * d]));
  // Crosses the border: only the inside part (plus the border strip) is kept.
  const crossing = clipPath(
    path([
      [-5, 2],
      [1, 2],
      [3, 2],
      [20, 2],
    ]),
    0,
    r,
    25,
  );
  assert.equal(crossing.length, 1);
  assert.deepEqual(
    crossing[0].map((v) => Math.round(v / d)),
    [1, 2, 3, 2],
  );
  // Follows the border just outside it for 8° (about 890 km): a border river.
  const border = clipPath(
    path([
      [10.02, 1],
      [10.02, 5],
      [10.02, 9],
    ]),
    0,
    r,
    25,
  );
  assert.equal(border.length, 1);
  // The same, for 0.1°: a neighbour's river brushing past.
  assert.equal(
    clipPath(
      path([
        [10.02, 1],
        [10.02, 1.1],
      ]),
      0,
      r,
      25,
    ).length,
    0,
  );
  // A line far away is skipped by its box.
  const far = {
    xy: path([
      [50, 50],
      [51, 51],
    ]),
    box: { x0: 0.87, y0: 0.87, x1: 0.89, y1: 0.89 },
    rank: 3,
    kind: /** @type {const} */ ("river"),
  };
  assert.equal(clipLines([far], r, 25).length, 0);
});

test("rivers: GeoJSON is read defensively", () => {
  const fc = (/** @type {any[]} */ features) => ({ type: "FeatureCollection", features });
  const lines = parseRivers(
    fc([
      {
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
        properties: { scalerank: 3, featurecla: "River" },
      },
      {
        geometry: {
          type: "MultiLineString",
          coordinates: [
            [
              [0, 0],
              [1, 1],
            ],
            [
              [2, 2],
              ["x", 3],
            ],
          ],
        },
        properties: { featurecla: "Intermittent River" },
      },
      { geometry: null, properties: {} },
      {
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [999, 1],
          ],
        },
        properties: {},
      },
    ]),
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0].rank, 3);
  assert.equal(lines[1].kind, "intermittent");
  assert.equal(lines[1].rank, 12); // no rank: the smallest
  assert.throws(() => parseRivers({ type: "Feature" }));
  assert.throws(() => parseRivers(fc(Array(30000).fill(null))));
  const lakes = parseLakes(
    fc([
      {
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
            [[9, 9]],
          ],
        },
      },
    ]),
  );
  assert.equal(lakes.length, 1);
  assert.equal(lakes[0].rings.length, 1); // the broken hole is dropped
  assert.ok(rankWidth(0) > rankWidth(6) && rankWidth(6) > rankWidth(12) && rankWidth(12) > 0);
});
