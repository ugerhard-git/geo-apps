// Unit tests for the pure modules inside the apps. Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { casePair, parseUnicodeSet, scriptOf } from "../../apps/alphabets/unicode.js";
import { annual, archiveUrl, normalsFrom } from "../../apps/climate/climate.js";
import { axesFor, niceRange } from "../../apps/climate/render.js";
import { candidateQuery, detailQueries, mergeDetails } from "../../scripts/landmarks/query.js";
import { dropReason, fileName, pickName, selectLandmarks } from "../../scripts/landmarks/select.js";
import { fitCredit, wrapCredit } from "../../shared/credits.js";
import { decodeCities, isFormatError } from "../../shared/geonames.js";
import { justifiedRows } from "../../shared/justified.js";
import { extentOf, pickDots, radiusFor } from "../../apps/city-dots/dots.js";
import { joinChoices } from "../../apps/export-treemap/countries.js";
import { cubeFor, toProducts } from "../../apps/export-treemap/oec.js";
import { squarify } from "../../apps/export-treemap/treemap.js";
import { quantise } from "../../apps/flagcolours/measure.js";
import { buildData, csvCell, safeName, valueAt } from "../../apps/owid-chart-plotter/data.js";
import { splitSlug } from "../../apps/owid-chart-plotter/owid.js";
import { kindMatches, parseCountryFile } from "../../apps/landmarks/data.js";
import { creditText } from "../../apps/landmarks/render.js";
import { Region, clipLines, clipPath } from "../../apps/rivers/clip.js";
import { parseLakes, parseRivers } from "../../apps/rivers/data.js";
import { rankWidth } from "../../apps/rivers/render.js";
import { applyAffix, detectAffix, stripAffix } from "../../apps/subdivisions/names.js";
import { parseData } from "../../apps/keyboards/data.js";
import { barsFor, parseData as parseLetters } from "../../apps/letters/data.js";
import { percentText, printable as printLetter } from "../../apps/letters/render.js";
import {
  cldrCode,
  isLetter,
  languagesFor,
  letterShares,
  parseCsv,
} from "../../scripts/letters/select.js";
import { capFor, isNonLatin, keyboard, printable, side } from "../../apps/keyboards/keys.js";
import { insetPolygon } from "../../apps/keyboards/render.js";
import { layoutsFor, localeOf } from "../../scripts/keyboards/countries.js";
import { isAnsi, layerOf, layoutId, legend, parseLayout } from "../../scripts/keyboards/parse.js";

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
  // Names only when asked for, decoded as UTF-8.
  assert.equal(
    /** @type {any[]} */ (decodeCities(buf, { names: true }).get("CH"))[0].name,
    "Zürich",
  );
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

/* ── Climate charts ──────────────────────────────────────── */

/** Thirty years of daily data: 10 °C in January rising by 1 °C a month, 1 mm of rain a day. */
function dailyArchive() {
  const time = [];
  const mean = [];
  for (let d = Date.UTC(1991, 0, 1); d <= Date.UTC(2020, 11, 31); d += 864e5) {
    const dt = new Date(d);
    time.push(dt.toISOString().slice(0, 10));
    mean.push(10 + dt.getUTCMonth());
  }
  return {
    elevation: 34,
    daily: {
      time,
      temperature_2m_mean: mean,
      temperature_2m_max: mean.map((v) => v + 5),
      temperature_2m_min: mean.map((v) => v - 5),
      precipitation_sum: mean.map(() => 1),
    },
  };
}

test("climate: thirty years of days average into twelve months", () => {
  const n = normalsFrom(dailyArchive());
  assert.deepEqual(n.mean, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  assert.equal(n.high[0], 15);
  assert.equal(n.low[11], 16);
  assert.equal(n.precip[0], 31); // a month's total, not a daily figure
  assert.ok(Math.abs(/** @type {number} */ (n.precip[1]) - (28 + 8 / 30)) < 1e-9); // 8 leap years in 30
  assert.equal(n.elevation, 34);
  const a = annual(n);
  assert.ok(Math.abs(/** @type {number} */ (a.precip) - (365 + 8 / 30)) < 1e-9);
});

test("climate: gaps and bad values don't skew the normals", () => {
  const data = dailyArchive();
  const d = data.daily;
  // Every March missing a day of rain: no March totals, so no March normal.
  d.time.forEach((t, i) => {
    if (t.endsWith("-03-15")) d.precipitation_sum[i] = /** @type {any} */ (null);
    if (t.startsWith("2000-01")) d.temperature_2m_mean[i] = /** @type {any} */ ("hot");
  });
  const n = normalsFrom(data);
  assert.equal(n.precip[2], null);
  assert.equal(n.precip[3], 30);
  assert.equal(n.mean[0], 10); // the junk January is simply skipped
  assert.equal(annual(n).precip, null);
  assert.throws(() => normalsFrom({ daily: { time: [1, 2], temperature_2m_mean: [1] } }));
  assert.throws(() => normalsFrom(null));
});

test("climate: request URLs carry only checked coordinates", () => {
  const u = new URL(archiveUrl(52.52437, 13.41053));
  assert.equal(u.hostname, "archive-api.open-meteo.com");
  assert.equal(u.searchParams.get("latitude"), "52.524");
  assert.equal(u.searchParams.get("start_date"), "1991-01-01");
  assert.throws(() => archiveUrl(NaN, 0));
  assert.throws(() => archiveUrl(91, 0));
});

test("climate: axes — round ticks, and Walter–Lieth's tenfold shrink above 100 mm", () => {
  assert.deepEqual(niceRange(-3.2, 21.7, 5), { lo: -5, hi: 25, step: 5 });
  const n = {
    mean: [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25],
    high: Array(12).fill(30),
    low: Array(12).fill(20),
    precip: [300, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    elevation: null,
  };
  const wl = axesFor(n, { imperial: false, walterLieth: true, band: true });
  assert.equal(wl.pPos(20), 10); // 20 mm = 10 °C
  assert.equal(wl.pPos(100), 50);
  assert.equal(wl.pPos(300), 60); // 200 mm more is only 10 °C more
  assert.equal(wl.t.hi, 60);
  assert.equal(wl.knee, 100);
  assert.deepEqual(wl.pTicks.slice(-2), [100, 300]);
  const fit = axesFor(n, { imperial: true, walterLieth: true, band: true });
  assert.equal(fit.knee, null); // no Walter–Lieth in °F
  assert.ok(fit.t.lo <= 68 && fit.t.hi >= 86);
});

/* ── Landmarks ───────────────────────────────────────────── */

const ENT = (/** @type {string} */ id) => ({ value: "http://www.wikidata.org/entity/" + id });
const LIT = (/** @type {string} */ v) => ({ value: v });

test("landmarks data: queries only take checked codes and ids", () => {
  assert.match(candidateQuery("FR", 300), /wdt:P297 "FR"/);
  assert.throws(() => candidateQuery('FR" } DROP', 300));
  const parts = detailQueries(["Q243", "nope", 'Q1" }']);
  assert.deepEqual(
    parts.map((p) => p.part),
    ["basic", "types", "groups", "also", "heritage", "labels"],
  );
  for (const p of parts) assert.match(p.query, /VALUES \?item \{ wd:Q243 \}/);
  assert.throws(() => detailQueries(["x"]));
});

test("landmarks data: photo names, other-language names", () => {
  assert.equal(
    fileName("http://commons.wikimedia.org/wiki/Special:FilePath/Tour%20Eiffel_2.jpg"),
    "Tour Eiffel 2.jpg",
  );
  assert.equal(fileName("http://commons.wikimedia.org/wiki/Special:FilePath/Map.svg"), ""); // not a photo
  assert.equal(fileName("http://commons.wikimedia.org/wiki/Special:FilePath/a%2F..%2Fb.jpg"), "");
  assert.equal(fileName("https://evil.example/Special:FilePath/x.jpg"), "");
  assert.equal(pickName("Eiffel Tower", "fr::tour Eiffel"), "Eiffel Tower");
  assert.equal(pickName("", "de::Eiffelturm || fr::tour Eiffel"), "tour Eiffel"); // French before German
  assert.equal(pickName("", ""), "");
});

test("landmarks data: what is dropped, and why", () => {
  const base = {
    types: ["tower"],
    also: [],
    isClass: false,
    hasCoord: true,
    hasPop: false,
    arch: false,
    file: "a.jpg",
    sl: 50,
  };
  assert.equal(dropReason(base), "");
  assert.equal(dropReason({ ...base, sl: 3 }), "too obscure");
  assert.equal(dropReason({ ...base, file: "" }), "no usable photograph");
  assert.equal(dropReason({ ...base, isClass: true }), "a type, not a place");
  assert.equal(dropReason({ ...base, hasCoord: false }), "no coordinates");
  assert.equal(dropReason({ ...base, also: ["DE", "IT", "AT"] }), "spans 4 countries");
  assert.equal(dropReason({ ...base, also: ["IT"] }), ""); // shared with one neighbour: kept, flagged
  assert.equal(
    dropReason({ ...base, hasPop: true, arch: true }),
    "has a population (town, region or country)",
  );
  assert.equal(dropReason({ ...base, types: ["big city"] }), "town or region");
  assert.equal(dropReason({ ...base, types: ["commune of France"] }), "town or region");
  assert.equal(dropReason({ ...base, types: ["city gate"] }), ""); // not a city
  assert.equal(
    dropReason({ ...base, types: ["fortified town", "human settlement"] }),
    "town or region",
  );
  assert.equal(
    dropReason({
      ...base,
      types: ["cadastral populated place in the Netherlands", "international airport"],
    }),
    "",
  ); // Schiphol
  assert.equal(dropReason({ ...base, types: ["ancient city"], arch: true }), ""); // Thebes
  assert.equal(dropReason({ ...base, types: ["strait", "sea"] }), "broad geography");
  assert.equal(dropReason({ ...base, types: ["mountain range", "mountain"] }), "");
  assert.equal(dropReason({ ...base, types: ["railway tunnel"] }), "not a single sight");
  assert.equal(dropReason({ ...base, types: ["road-rail bridge", "through arch bridge"] }), ""); // Sydney Harbour Bridge
  assert.equal(dropReason({ ...base, types: ["international airport"] }), ""); // airports stay
  assert.equal(dropReason({ ...base, types: ["stadium"] }), ""); // so do stadiums
});

test("landmarks data: detail parts merge into one row per item", () => {
  const rows = mergeDetails(
    [
      {
        part: "basic",
        rows: [
          {
            item: ENT("Q243"),
            en: LIT("Eiffel Tower"),
            img: LIT("http://commons.wikimedia.org/wiki/Special:FilePath/T.jpg"),
            pt: LIT("Point(2.29 48.86)"),
            category: LIT("Eiffel Tower"),
          },
        ],
      },
      {
        part: "types",
        rows: [
          { item: ENT("Q243"), typeLabel: LIT("lattice tower") },
          { item: ENT("Q999"), typeLabel: LIT("stray") },
        ],
      },
      {
        part: "groups",
        rows: [
          { item: ENT("Q243"), g: LIT("built") },
          { item: ENT("Q243"), g: LIT("arch") },
        ],
      },
      {
        part: "also",
        rows: [
          { item: ENT("Q243"), oiso: LIT("FR") },
          { item: ENT("Q243"), oiso: LIT("BE") },
        ],
      },
      {
        part: "heritage",
        rows: [{ item: ENT("Q243"), site: ENT("Q190"), siteLabel: LIT("Banks of the Seine") }],
      },
    ],
    new Map([["Q243", "191"]]),
  );
  assert.equal(rows.length, 1);
  const { kept } = selectLandmarks(rows, "FR");
  assert.deepEqual(kept[0], {
    id: "Q243",
    name: "Eiffel Tower",
    sl: 191,
    file: "T.jpg",
    lat: 48.86,
    lon: 2.29,
    kind: "built",
    types: ["lattice tower"],
    whs: true,
    partOf: { id: "Q190", name: "Banks of the Seine" },
    also: ["BE"],
    cat: "Eiffel Tower",
  });
});

test("landmarks app: data files are checked again on reading", () => {
  const good = {
    id: "Q243",
    name: "Eiffel Tower",
    sl: 191,
    file: "T.jpg",
    kind: "built",
    types: ["tower"],
    whs: true,
    partOf: null,
    also: ["IT", "xx", "FR"],
    cat: "Eiffel Tower",
  };
  const list = parseCountryFile(
    {
      country: "FR",
      items: [
        { ...good, id: "Q2", sl: 10, name: "Smaller" },
        good,
        { ...good, id: "Q3", file: "../x.jpg" },
        { ...good, id: "Q4", file: "map.svg" },
        { ...good, id: "nope" },
        { ...good, id: "Q5", name: "" },
        { ...good, id: "Q6", kind: "evil", cat: "<b>", sl: 1e9 },
      ],
    },
    "FR",
  );
  assert.deepEqual(
    list.map((l) => l.id),
    ["Q243", "Q2", "Q6"],
  );
  assert.equal(list[0].rank, 1);
  assert.deepEqual(list[0].also, ["IT"]);
  assert.equal(list[2].kind, "");
  assert.equal(list[2].cat, "");
  assert.equal(list[2].sl, 0);
  assert.throws(() => parseCountryFile({ country: "DE", items: [] }, "FR"));
  assert.ok(kindMatches({ ...list[0], kind: "both" }, "natural"));
  assert.ok(!kindMatches(list[0], "natural"));
  assert.equal(
    creditText({
      name: "x",
      thumb: "",
      full: "",
      author: "",
      licence: { label: "CC BY 2.0" },
      describeUrl: "https://commons.wikimedia.org/w/index.php?curid=5",
    }),
    "Wikimedia Commons · CC BY 2.0 · commons.wikimedia.org/w/index.php?curid=5",
  );
});

test("keyboards data: CLDR keyboard files are read layer by layer, cleaned", () => {
  assert.equal(layoutId("de-CH-t-k0-windows.xml"), "de-CH");
  assert.equal(layoutId("en-t-k0-windows-extended.xml"), "en-extended");
  assert.equal(layoutId("_platform.xml"), "");
  assert.equal(layerOf(undefined), "base");
  assert.equal(layerOf("shift caps"), "shift");
  assert.equal(layerOf("shift+caps?"), "shift");
  assert.equal(layerOf("altR+caps? ctrl+alt+caps?"), "altgr");
  assert.equal(layerOf("altR+shift+caps? ctrl+alt+shift+caps?"), "altgrShift");
  assert.equal(layerOf("ctrl+caps?"), "");
  assert.equal(layerOf("caps"), "");
  assert.equal(legend("&lt;"), "<");
  assert.equal(legend("\\u{22}"), '"');
  assert.equal(legend("\\u{1C}"), ""); // a control character
  assert.equal(legend("\\u{200D}"), ""); // invisible joiner
  assert.equal(legend("\\u{110000}"), ""); // not a code point
  assert.equal(legend("abcdefgh"), ""); // too long for a keycap

  const xml = `<keyboard><names><name value="Test &amp; Co (FYROM)"/></names>
    <keyMap><map iso="D01" to="q"/><map iso="E00" to="^"/><map iso="Z99" to="x"/></keyMap>
    <keyMap modifiers="shift caps"><map iso="D01" to="Q"/></keyMap>
    <keyMap modifiers="caps"><map iso="D01" to="WRONG"/></keyMap>
    <keyMap modifiers="altR+caps? ctrl+alt+caps?"><map iso="D01" to="@"/></keyMap>
    <transforms type="simple"><transform from="^a" to="â"/></transforms></keyboard>`;
  const l = parseLayout(xml);
  assert.equal(l.name, "Test & Co");
  assert.deepEqual(l.keys.D01, ["q", "Q", "@", ""]);
  assert.equal(l.keys.Z99, undefined);
  assert.equal(l.dead, "^");
  assert.ok(isAnsi({ C12: ["\\", "|"], B00: ["\\", "|"] }));
  assert.ok(!isAnsi({ C12: ["#", "'"], B00: ["<", ">"] }));
});

test("keyboards data: countries get their own layout, then their language's", () => {
  const ids = [
    "en",
    "en-GB",
    "en-dvorak",
    "de",
    "de-CH",
    "fr",
    "fr-CH",
    "es",
    "es-419",
    "pt",
    "pt-PT",
    "sr",
    "sr-Latn",
  ];
  assert.equal(localeOf("el-Latn-el220"), "el-Latn");
  assert.equal(localeOf("es-419"), "es-419");
  assert.equal(localeOf("fr-CA-var"), "fr-CA");
  const lp = (/** @type {Record<string, [number, string]>} */ m) =>
    Object.fromEntries(
      Object.entries(m).map(([k, [p, s]]) => [
        k,
        { _populationPercent: String(p), _officialStatus: s },
      ]),
    );
  assert.deepEqual(layoutsFor("AT", lp({ de: [97, "official"], en: [73, ""] }), ids), ["de"]);
  assert.deepEqual(layoutsFor("MX", lp({ es: [92, "de_facto_official"] }), ids), ["es-419"]);
  assert.deepEqual(layoutsFor("AO", lp({ pt: [70, "official"] }), ids), ["pt-PT"]);
  assert.deepEqual(layoutsFor("RS", lp({ sr: [90, "official"], sr_Latn: [80, "official"] }), ids), [
    "sr",
    "sr-Latn",
  ]);
  // Dvorak never; no own layout → US.
  assert.deepEqual(layoutsFor("KE", lp({ sw: [80, "official"] }), ids), ["en"]);
  // The hand-set exceptions win.
  assert.deepEqual(layoutsFor("CH", lp({ de: [64, "official"] }), ids), ["de-CH", "fr-CH"]);
});

test("keyboards app: the shapes add up to full rows", () => {
  for (const shape of /** @type {const} */ (["iso", "ansi", "jis"])) {
    const kb = keyboard(shape);
    for (let y = 0; y < 5; y++) {
      // Every row is 15 wide; the tall Enter counts on both of its rows.
      const w = kb.keys
        .filter((k) => k.y <= y && y < k.y + k.h)
        .reduce((s, k) => s + (k.outline ? (y === 1 ? 1.5 : 1.25) : k.w), 0);
      assert.equal(w, 15, `${shape} row ${y}`);
    }
  }
  const pos = (/** @type {import("../../apps/keyboards/keys.js").KeyBox[]} */ keys) =>
    keys.map((k) => k.pos).filter(Boolean);
  assert.ok(pos(keyboard("iso").keys).includes("B00"));
  assert.ok(!pos(keyboard("ansi").keys).includes("B00"));
  assert.ok(pos(keyboard("jis").keys).includes("E13"));
  assert.ok(pos(keyboard("iso", { b11: true }).keys).includes("B11"));
  assert.equal(keyboard("iso", { bottom: false }).h, 4);
  // The L-shaped Enter keeps its shape when inset.
  const L = /** @type {Array<[number, number]>} */ ([
    [13.5, 1],
    [15, 1],
    [15, 3],
    [13.75, 3],
    [13.75, 2],
    [13.5, 2],
  ]);
  assert.deepEqual(insetPolygon(L, 0.1, 0.1, 0.1, 0.1), [
    [13.6, 1.1],
    [14.9, 1.1],
    [14.9, 2.9],
    [13.85, 2.9],
    [13.85, 1.9],
    [13.6, 1.9],
  ]);
});

test("keyboards app: what each keycap prints", () => {
  const opts = { shift: true, altgr: true, latin: true };
  const us = { D01: ["q", "Q"], E02: ["2", "@"], E01: ["1", "!"] };
  assert.deepEqual(side("q", "Q", true), { kind: "letter", ch: "Q" });
  assert.deepEqual(side("1", "!", true), { kind: "pair", top: "!", bottom: "1" });
  assert.deepEqual(side("1", "!", false), { kind: "pair", top: "", bottom: "1" });
  assert.equal(printable("\u064E"), "\u25CC\u064E");
  // German Q: a capital, with @ on AltGr.
  const de = { D01: ["q", "Q", "@"] };
  assert.deepEqual(capFor("D01", de, us, false, opts), {
    left: { kind: "letter", ch: "Q" },
    right: null,
    altgr: { kind: "pair", top: "", bottom: "@" },
  });
  // Russian: Latin small on the left, Cyrillic on the right; a shared digit only once.
  const ru = { D01: ["й", "Й"], E02: ["2", '"'], E01: ["1", "!"] };
  assert.ok(isNonLatin({ D01: ["й", "Й"], C01: ["ф", "Ф"], B01: ["я", "Я"] }));
  const q = capFor("D01", ru, us, true, opts);
  assert.deepEqual(
    [q.left, q.right],
    [
      { kind: "letter", ch: "Q" },
      { kind: "letter", ch: "Й" },
    ],
  );
  const two = capFor("E02", ru, us, true, opts);
  assert.deepEqual(two.right, { kind: "pair", top: '"', bottom: "" });
  assert.equal(capFor("E01", ru, us, true, opts).right, null);
  // Without Latin legends, only the native side.
  assert.equal(capFor("D01", ru, us, true, { ...opts, latin: false }).left, null);
  // A key the layout doesn't have stays blank.
  assert.deepEqual(capFor("E00", ru, us, true, opts), { left: null, right: null, altgr: null });
  // Korean: printed jamo beside the Latin letter.
  const ko = { D01: ["q", "Q", "", "", "ㅂ", "ㅃ"] };
  const k = capFor("D01", ko, us, true, opts);
  assert.deepEqual(k.right, { kind: "pair", top: "ㅃ", bottom: "ㅂ" });
  assert.ok(k.printed);
});

test("keyboards app: the layout file is checked on reading", () => {
  const many = Object.fromEntries(
    ["E", "D", "C"].flatMap((r) =>
      Array.from({ length: 12 }, (_, i) => [`${r}${String(i + 1).padStart(2, "0")}`, ["a", "A"]]),
    ),
  );
  const data = parseData({
    layouts: {
      en: { name: "US", shape: "ansi", keys: many },
      bad: { name: "<b>x</b>", shape: "round", keys: many },
      "../x": { name: "Path", shape: "iso", keys: many },
      ok: {
        name: "OK",
        shape: "iso",
        keys: { ...many, Z01: ["x"], E01: ["far too long a legend"] },
        latin: "nope",
      },
    },
    countries: { DE: ["ok", "missing"], xx: ["ok"], FR: [] },
  });
  assert.deepEqual([...data.layouts.keys()].sort(), ["en", "ok"]);
  const ok = /** @type {any} */ (data.layouts.get("ok"));
  assert.equal(ok.keys.Z01, undefined);
  assert.deepEqual(ok.keys.E01, [""]);
  assert.equal(ok.latin, "en");
  assert.deepEqual([...data.countries.entries()], [["DE", ["ok"]]]);
  assert.throws(() => parseData({ layouts: {}, countries: {} }));
});

test("letters data: FineFreq counts become letter shares, nothing else", () => {
  const csv =
    "character,unicode_category,total_frequency_all_time\n" +
    "a,Ll,600\nA,Lu,200\nI,Lu,100\ni,Ll,50\n\u0131,Ll,50\n\u02BB,Lm,100\n,,\n" +
    '"\u0301",Mn,20\n",",Po,999\n\u0634,Lo,500\n1,Nd,999\n\u00DF,Ll,10\n\u1E9E,Lu,10\n';
  const rows = parseCsv(csv);
  assert.equal(rows.find((r) => r.character === ",")?.total_frequency_all_time, "999");
  assert.ok(isLetter("\u02BB", "Lm"));
  assert.ok(isLetter("\u0301", "Mn"));
  assert.ok(!isLetter("\u0634", "Lo")); // Arabic: not a Latin letter
  assert.ok(!isLetter(",", "Po"));
  // Turkish: I is the capital of ı, not of i.
  const tr = new Map(letterShares(rows, "tr").letters);
  const en = new Map(letterShares(rows, "en").letters);
  assert.equal(letterShares(rows, "tr").total, 1140);
  assert.equal(tr.get("\u0131"), Math.round((150 / 1140) * 100 * 1e4) / 1e4);
  assert.equal(en.get("i"), Math.round((150 / 1140) * 100 * 1e4) / 1e4);
  assert.equal(en.get("a"), Math.round((800 / 1140) * 100 * 1e4) / 1e4);
  assert.equal(en.get("\u00DF"), Math.round((20 / 1140) * 100 * 1e4) / 1e4); // ẞ folds into ß
  assert.equal(en.get("\u0634"), undefined);
  assert.equal(letterShares([], "en").letters.length, 0);
});

test("letters data: languages per country, FineFreq codes to CLDR ones", () => {
  const aliases = {
    swh: { _replacement: "sw" },
    deu: { _replacement: "de" },
    cnr: { _replacement: "sr-ME" },
  };
  assert.equal(cldrCode("swh", aliases), "sw");
  assert.equal(cldrCode("cnr", aliases), "cnr");
  assert.equal(cldrCode("smo", aliases), "smo");
  const scriptOf = (/** @type {string} */ c) =>
    c.includes("_") ? c.split("_")[1] : c === "ar" ? "Arab" : "Latn";
  const have = new Set(["de", "en", "sw", "tk", "sr", "fr"]);
  const lp = (/** @type {Record<string, [number, string]>} */ m) =>
    Object.fromEntries(
      Object.entries(m).map(([k, [p, st]]) => [
        k,
        { _populationPercent: String(p), _officialStatus: st },
      ]),
    );
  assert.deepEqual(languagesFor(lp({ de: [91, "official"], en: [64, ""] }), scriptOf, have), [
    "de",
  ]);
  assert.deepEqual(
    languagesFor(lp({ sw: [90, "official"], en: [69, "official"] }), scriptOf, have),
    ["sw", "en"],
  );
  // Only a regional Latin-script language: not a clue country.
  assert.deepEqual(
    languagesFor(lp({ ar: [50, "official"], tk: [3, "official_regional"] }), scriptOf, have),
    [],
  );
  // Serbian counts in its Latin spelling.
  assert.deepEqual(
    languagesFor(
      lp({ sr: [99, "official"], sr_Latn: [99, "official"] }),
      (c) => (c === "sr" ? "Cyrl" : scriptOf(c)),
      have,
    ),
    ["sr"],
  );
});

test("letters app: the data file is checked, the bars chosen and ordered", () => {
  const top = [
    ["e", 15],
    ["n", 10],
    ["a", 6],
    ["\u00E4", 0.5],
    ["\u00E5", 0.03],
    ["\u00F6", 0.3],
    ["<b>", 1],
    ["z", 101],
    ["\u0634", 1],
  ];
  for (const l of "bcdfghijklmopqrstu") top.push([l, 1]);
  const data = parseLetters({
    languages: {
      sv: { name: "Swedish", letters: 1e9, top },
      "../x": { name: "X", top },
      de: { name: "German", top: [] },
    },
    countries: { SE: ["sv", "xx"], se: ["sv"] },
  });
  assert.deepEqual([...data.languages.keys()], ["sv"]);
  assert.deepEqual([...data.countries.keys()], ["SE"]);
  const sv = /** @type {any} */ (data.languages.get("sv"));
  assert.ok(
    !sv.top.some(
      (/** @type {[string, number]} */ [c]) => c === "<b>" || c === "z" || c === "\u0634",
    ),
  );
  const freq = barsFor(sv, { order: "frequency", basicOnly: false, minPercent: 0.05 });
  assert.equal(freq[0].letter, "e");
  assert.ok(!freq.some((b) => b.letter === "\u00E5")); // rarer than 0.05 %
  assert.deepEqual(
    barsFor(sv, { order: "frequency", basicOnly: true, minPercent: 0 }).filter((b) => b.extra),
    [],
  );
  // Swedish alphabetical order puts ä and ö after the 26.
  const abc = barsFor(sv, { order: "alphabet", basicOnly: false, minPercent: 0 }).map(
    (b) => b.letter,
  );
  assert.deepEqual(abc.slice(-3), ["\u00E5", "\u00E4", "\u00F6"]);
  // Compared with English: a–z get English's share, other letters none.
  const en = {
    code: "en",
    name: "English",
    letters: 1,
    top: /** @type {Array<[string, number]>} */ ([
      ["e", 12],
      ["a", 8],
      ["n", 7],
    ]),
  };
  const cmp = barsFor(sv, { order: "frequency", basicOnly: false, minPercent: 0 }, en);
  assert.equal(cmp.find((b) => b.letter === "e")?.english, 12);
  assert.equal(cmp.find((b) => b.letter === "b")?.english, null); // not in this English sample
  assert.equal(cmp.find((b) => b.letter === "\u00E4")?.english, null);
  assert.ok(
    barsFor(sv, { order: "frequency", basicOnly: false, minPercent: 0 }).every(
      (b) => b.english === null,
    ),
  );
  // English isn't compared with itself.
  assert.ok(
    barsFor(en, { order: "frequency", basicOnly: false, minPercent: 0 }, en).every(
      (b) => b.english === null,
    ),
  );
  assert.equal(percentText(15.99), "16.0");
  assert.equal(percentText(6.4), "6.4");
  assert.equal(percentText(0.004), "<0.01");
  assert.equal(printLetter("\u0301", false), "\u25CC\u0301");
  assert.equal(printLetter("\u00DF", true), "\u1E9E");
  assert.equal(printLetter("\u0149", true), "\u0149"); // ŉ has no one-letter capital
});
