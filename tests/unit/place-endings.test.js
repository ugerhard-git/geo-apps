// Unit tests for Place-name endings (apps/place-endings/endings.js and the
// cloud's layout helpers). Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  distinctWords,
  endingsOfWord,
  mainWord,
  pickTowns,
  splitEnding,
  typicalEndings,
  worldBaseline,
} from "../../apps/place-endings/endings.js";
import { cloudOrder, relativeSizes } from "../../apps/place-endings/render.js";
import { rng } from "../../shared/util.js";

test("a place name's ending is on its longest word, in lower case", () => {
  assert.equal(mainWord("Nowy Dwór Mazowiecki"), "mazowiecki");
  assert.equal(mainWord("Frankfurt am Main"), "frankfurt");
  assert.equal(mainWord("KRAKÓW"), "kraków");
  assert.equal(mainWord("Bad Homburg"), "homburg");
  assert.equal(mainWord("A B"), "");
  // Romanian ş (cedilla) and ș (comma) are one letter.
  assert.equal(mainWord("Piteşti"), mainWord("Pitești"));
});

test("endings run from two letters to six, leaving two in front", () => {
  assert.deepEqual(endingsOfWord("kraków"), ["ów", "ków", "aków"]);
  assert.deepEqual(endingsOfWord("ketrzyn"), ["yn", "zyn", "rzyn", "trzyn"]);
  assert.deepEqual(endingsOfWord("ems"), []);
  assert.deepEqual(endingsOfWord("åsby"), ["by"]);
});

test("districts sharing a name count once", () => {
  const cities = [
    { name: "Budapest XI. kerület" },
    { name: "Budapest XII. kerület" },
    { name: "Pécs" },
  ];
  assert.deepEqual(distinctWords(/** @type {any} */ (cities)).sort(), ["budapest", "pécs"]);
});

/** A distinct made-up word stem for a number: 0 → "baa", 1 → "bab"… */
const stem = (/** @type {number} */ i) =>
  "b" + String.fromCharCode(97 + (Math.floor(i / 26) % 26)) + String.fromCharCode(97 + (i % 26));

/**
 * A made-up world: Land A's names end in -torp and -by far more often than
 * the rest of the world's; everyone has plenty of -on.
 */
function world() {
  const landA = [
    ...Array.from({ length: 40 }, (_, i) => stem(i) + "torp"),
    ...Array.from({ length: 25 }, (_, i) => stem(i) + "by"),
    ...Array.from({ length: 60 }, (_, i) => stem(i) + "on"),
  ];
  const rest = Array.from({ length: 600 }, (_, i) => stem(i) + (i % 3 ? "on" : "an"));
  return { landA, rest };
}

test("typical endings are the ones a country uses far more than the world", () => {
  const { landA, rest } = world();
  const baseline = worldBaseline([landA, rest]);
  const found = typicalEndings(landA, baseline, 12).map((e) => e.text);
  assert.ok(found.includes("torp"), `found ${found}`);
  assert.ok(found.includes("by"), `found ${found}`);
  assert.ok(!found.includes("on"), "common everywhere, so not typical");
  // -rp grew into -torp, and only one of -orp, -torp is kept.
  assert.ok(!found.includes("rp") && !found.includes("orp"));
  assert.ok(typicalEndings(landA, baseline, 1).length === 1);
  assert.deepEqual(typicalEndings([], baseline, 12), []);
});

test("a name is split before its longest typical ending", () => {
  const endings = [
    { text: "ów", count: 10 },
    { text: "owice", count: 5 },
  ];
  assert.deepEqual(splitEnding("Katowice", endings), ["Kat", "owice"]);
  assert.deepEqual(splitEnding("Chojnów", endings), ["Chojn", "ów"]);
  assert.deepEqual(splitEnding("Łeba", endings), ["Łeba", ""]);
  // Not the whole name.
  assert.deepEqual(splitEnding("Ów", endings), ["Ów", ""]);
  // A cedilla ş in the name still matches an ending written with ș.
  assert.deepEqual(splitEnding("Piteşti", [{ text: "ești", count: 9 }]), ["Pit", "eşti"]);
});

test("towns: one word, big enough, without the largest cities, the same for the same seed", () => {
  const cities = [
    { name: "Capital", pop: 2_000_000 },
    { name: "Second", pop: 900_000 },
    ...Array.from({ length: 40 }, (_, i) => ({
      name: `Town${"abcdefghij"[i % 10]}${"klmnopqrst"[Math.floor(i / 10)]}`,
      pop: 5000 + i,
    })),
    { name: "Two Words", pop: 8000 },
    { name: "Tiny", pop: 1200 },
  ];
  const opts = { minPop: 3000, skipLargest: 2, random: rng(42) };
  const towns = pickTowns(/** @type {any} */ (cities), 12, opts);
  assert.equal(towns.length, 12);
  assert.ok(!towns.includes("Capital") && !towns.includes("Second"));
  assert.ok(!towns.includes("Two Words") && !towns.includes("Tiny"));
  assert.equal(new Set(towns).size, 12);
  assert.deepEqual(pickTowns(/** @type {any} */ (cities), 12, { ...opts, random: rng(42) }), towns);
  assert.notDeepEqual(
    pickTowns(/** @type {any} */ (cities), 12, { ...opts, random: rng(43) }),
    towns,
  );
});

test("the cloud puts the most common ending in the middle, sized by area", () => {
  const e = [
    { text: "a", count: 100 },
    { text: "b", count: 25 },
    { text: "c", count: 50 },
    { text: "d", count: 4 },
  ];
  const order = cloudOrder(e).map((x) => x.text);
  assert.equal(order.length, 4);
  // The biggest sits next to the middle; the smallest at an edge.
  assert.ok([1, 2].includes(order.indexOf("a")), order.join(""));
  assert.ok([0, 3].includes(order.indexOf("d")), order.join(""));
  const rel = relativeSizes(e);
  assert.equal(rel.get(e[0]), 1);
  assert.equal(rel.get(e[3]), 0.4);
  assert.ok(/** @type {number} */ (rel.get(e[2])) > /** @type {number} */ (rel.get(e[1])));
});
