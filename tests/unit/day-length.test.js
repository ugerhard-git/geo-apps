// Unit tests for Day length: the sun's times (apps/day-length/sun.js), the
// capitals file and its reader, and the chart's helpers. Run with
// `npm run test:unit`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { knownTimeZone, parseCapitalsFile } from "../../apps/day-length/capitals.js";
import { clockPieces, monthStarts } from "../../apps/day-length/render.js";
import {
  SUNRISE_ZENITH,
  clockText,
  extremes,
  sunEvents,
  utcOffset,
  yearOfDays,
} from "../../apps/day-length/sun.js";
import { parseCapitals } from "../../scripts/day-length/parse.js";

const MADRID = { lat: 40.4165, lon: -3.7026, tz: "Europe/Madrid" };
const REYKJAVIK = { lat: 64.1355, lon: -21.8954, tz: "Atlantic/Reykjavik" };

/** Minutes between two clock times, ignoring the sign. */
const off = (/** @type {number} */ a, /** @type {string} */ b) => {
  const [h, m] = b.split(":").map(Number);
  return Math.abs(a * 60 - (h * 60 + m));
};

test("sunrise and sunset match published times to within a few minutes", () => {
  const madrid = yearOfDays(MADRID, 2026);
  // Madrid, 1 January: sunrise about 8:38, sunset about 18:00.
  const jan1 = /** @type {[number, number]} */ (madrid[0].sun);
  assert.ok(off(jan1[0], "8:38") <= 3, clockText(jan1[0]));
  assert.ok(off(jan1[1], "17:59") <= 3, clockText(jan1[1]));
  // Reykjavík on 21 June: sunrise about 2:55, sunset just after midnight.
  const rey = /** @type {[number, number]} */ (yearOfDays(REYKJAVIK, 2026)[171].sun);
  assert.ok(off(rey[0], "2:55") <= 5, clockText(rey[0]));
  assert.ok(rey[1] > 24 && off(rey[1] - 24, "0:04") <= 6, clockText(rey[1]));
});

test("at the equator day and night are even all year; at the poles the sun stays up or down", () => {
  const quito = extremes(yearOfDays({ lat: -0.22, lon: -78.5, tz: "America/Guayaquil" }, 2026));
  assert.ok(quito.longest - quito.shortest < 0.15);
  assert.ok(Math.abs(quito.longest - 12.1) < 0.2);
  assert.equal(sunEvents(78, 15, 172, SUNRISE_ZENITH), "day"); // Svalbard, midsummer
  assert.equal(sunEvents(78, 15, 355, SUNRISE_ZENITH), "night"); // Svalbard, midwinter
});

test("summer time moves the clock on the right morning, and the hours of daylight don't jump", () => {
  assert.equal(utcOffset("Europe/Madrid", Date.UTC(2026, 0, 15, 12)), 60);
  assert.equal(utcOffset("Europe/Madrid", Date.UTC(2026, 6, 15, 12)), 120);
  assert.equal(utcOffset("Asia/Kathmandu", Date.UTC(2026, 0, 1)), 345);
  const madrid = yearOfDays(MADRID, 2026);
  // In 2026 summer time starts on Sunday 29 March: day 87, counted from 0.
  const before = /** @type {[number, number]} */ (madrid[86].sun)[0];
  const after = /** @type {[number, number]} */ (madrid[87].sun)[0];
  assert.ok(
    after - before > 0.9 && after - before < 1,
    `${clockText(before)} → ${clockText(after)}`,
  );
  assert.ok(Math.abs(madrid[87].hours - madrid[86].hours) < 0.1);
  // A leap year has 366 days.
  assert.equal(yearOfDays(MADRID, 2028).length, 366);
});

test("a stretch past midnight is drawn in two pieces", () => {
  assert.deepEqual(clockPieces(6, 18), [[6, 18]]);
  assert.deepEqual(
    clockPieces(2.9, 24.07).map((p) => p.map((x) => +x.toFixed(2))),
    [
      [2.9, 24],
      [0, 0.07],
    ],
  );
  assert.deepEqual(clockPieces(-0.5, 20), [
    [0, 20],
    [23.5, 24],
  ]);
  assert.deepEqual(clockPieces(1, 26), [[0, 24]]);
  assert.deepEqual(monthStarts(365).slice(0, 3), [0, 31, 59]);
  assert.equal(monthStarts(366)[12], 366);
  assert.equal(clockText(21.1667), "21:10");
});

test("the capitals file: every entry has a position and a time zone the runtime knows", () => {
  const file = JSON.parse(readFileSync("apps/day-length/data/capitals.json", "utf8"));
  const capitals = parseCapitalsFile(file);
  assert.equal(capitals.size, Object.keys(file.capitals).length, "nothing left out");
  assert.ok(capitals.size >= 200);
  for (const cc of ["IS", "ES", "AR", "SG", "FI"]) assert.ok(capitals.has(cc), cc);
  assert.equal(capitals.get("NP")?.tz, "Asia/Kathmandu");
  assert.match(file.source.licence, /CC BY/);
});

test("the reader drops what it can't use", () => {
  const got = parseCapitalsFile({
    capitals: {
      ES: { name: "Madrid", lat: 40.4, lon: -3.7, tz: "Europe/Madrid" },
      XX: { name: "Nowhere", lat: 95, lon: 0, tz: "Europe/Madrid" },
      YY: { name: "Bad zone", lat: 1, lon: 1, tz: "Mars/Olympus" },
      zz: { name: "Bad code", lat: 1, lon: 1, tz: "Europe/Madrid" },
      QQ: { name: "<b>", lat: 1, lon: 1, tz: "../../etc" },
    },
  });
  assert.deepEqual([...got.keys()], ["ES"]);
  assert.equal(parseCapitalsFile(null).size, 0);
  assert.ok(knownTimeZone("America/Argentina/Buenos_Aires"));
  assert.ok(!knownTimeZone("Europe/Atlantis"));
});

test("the build script keeps each country's most populous capital, and nothing else", () => {
  const row = (/** @type {string[]} */ f) => {
    const cols = Array(19).fill("");
    cols[1] = f[0];
    cols[4] = f[1];
    cols[5] = f[2];
    cols[7] = f[3];
    cols[8] = f[4];
    cols[14] = f[5];
    cols[17] = f[6];
    return cols.join("\t");
  };
  const tsv = [
    row(["Sucre", "-19.03", "-65.26", "PPLC", "BO", "224838", "America/La_Paz"]),
    row(["Smallville", "-19", "-65", "PPLC", "BO", "1000", "America/La_Paz"]),
    row(["Madrid", "40.4165", "-3.70256", "PPLC", "ES", "3255944", "Europe/Madrid"]),
    row(["Barcelona", "41.38", "2.17", "PPLA", "ES", "1620343", "Europe/Madrid"]),
    row(["Nowhere", "1", "1", "PPLC", "XY", "10", "Not/AZone"]),
  ].join("\n");
  const got = parseCapitals(tsv);
  assert.deepEqual(Object.keys(got), ["BO", "ES"]);
  assert.equal(got.BO.name, "Sucre");
  assert.equal(got.ES.lon, -3.7026);
});

test("in every look, day and night stay far apart", async () => {
  const { LOOKS, contrast } = await import("../../shared/looks.js");
  const { lookToControls } = await import("../../apps/day-length/presets.js");
  for (const look of LOOKS) {
    const c = lookToControls(look).set;
    assert.ok(contrast(c.dayColor, c.nightColor) >= 4.5, `${look.id}: day on night`);
  }
});
