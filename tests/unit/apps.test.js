// Unit tests for the pure modules inside the apps. Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { casePair, parseUnicodeSet, scriptOf } from "../../apps/alphabets/unicode.js";
import { joinChoices } from "../../apps/export-treemap/countries.js";
import { cubeFor, toProducts } from "../../apps/export-treemap/oec.js";
import { squarify } from "../../apps/export-treemap/treemap.js";
import { quantise } from "../../apps/flagcolours/measure.js";
import { buildData, csvCell, safeName, valueAt } from "../../apps/owid-chart-plotter/data.js";
import { splitSlug } from "../../apps/owid-chart-plotter/owid.js";
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
