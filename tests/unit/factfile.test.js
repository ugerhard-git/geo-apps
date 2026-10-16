// Unit tests for the Fact file app and its data build. Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { analyse, isWater } from "../../apps/factfile/blackout.js";
import { parseIndex, parseRecord } from "../../apps/factfile/data.js";
import { balance, fitScale, peopleText, spread } from "../../apps/factfile/render.js";
import {
  amountIn,
  demonym,
  extract,
  numberIn,
  plain,
  splitOutside,
} from "../../scripts/factfile/extract.js";

/** A small Factbook profile, shaped like the archive's JSON. */
const PROFILE = {
  Geography: {
    Area: { total: { text: "1.267 million sq km" } },
    Coastline: { text: "0 km (landlocked)" },
    Climate: { text: "desert; mostly hot, dry, dusty" },
  },
  "People and Society": {
    Nationality: {
      noun: { text: "Nigerien(s)" },
      adjective: { text: "Nigerien" },
    },
    "Major urban areas - population": {
      text: "1.437 million NIAMEY (capital), 2,050,000 Zinder (2023)",
    },
  },
  Government: {
    "Country name": {
      "conventional long form": { text: "Republic of Niger" },
      "conventional short form": { text: "Niger" },
    },
    Capital: { name: { text: "Niamey" } },
    "Government type": { text: "formerly, semi-presidential republic" },
    Independence: { text: "3 August 1960 (from France)" },
    "National holiday": { text: "Republic Day, 18 December (1958)" },
    "International organization participation": { text: "AU, ECOWAS, OIC, EU (observer), UN" },
    "Legislative branch": {
      "legislative structure": { text: "unicameral" },
      "number of seats": { text: "194 (all appointed); note - something" },
      "term in office": { text: "" },
    },
  },
};

test("plain decodes entities and drops tags, notes and years", () => {
  assert.equal(plain("R&eacute;publique &amp; <b>co</b> (2023 est.)"), "République & co");
  assert.equal(plain("C&ocirc;te d&#39;Ivoire"), "Côte d'Ivoire");
});

test("splitOutside ignores separators inside brackets", () => {
  assert.deepEqual(splitOutside("a (b; c); d", ";"), ["a (b; c)", "d"]);
});

test("numbers: commas, minus signs and millions", () => {
  assert.equal(numberIn("2,106 km"), 2106);
  assert.equal(numberIn("-28 m"), -28);
  assert.equal(numberIn("no number"), null);
  assert.equal(amountIn("1.267 million sq km"), 1267000);
  assert.equal(amountIn("41,277 sq km"), 41277);
});

test("extract reads a profile without giving names away", () => {
  const { names, fields } = extract(PROFILE);
  assert.ok(names.country.includes("Niger"));
  assert.ok(names.people.includes("Nigerien"));
  assert.ok(names.people.includes("Nigeriens"));
  assert.ok(names.places.includes("Republic Day"), "the holiday's name is blacked out");
  assert.equal(fields.area, 1267000);
  assert.equal(fields.coast, 0);
  // The largest city wins, even when the capital is listed first.
  assert.equal(fields.city.millions, 2.05);
  assert.equal(fields.city.capital, false);
  assert.deepEqual(fields.system, { text: "formerly semi-presidential republic", unsettled: true });
  assert.deepEqual(fields.independence, { date: "3 August 1960", event: "", from: "France" });
  assert.deepEqual(fields.holiday, { name: "Republic Day", date: "18 December" });
  assert.deepEqual(fields.memberships, ["Islamic Cooperation", "African Union", "ECOWAS"]);
  assert.equal(fields.parliament.chambers, 1);
  assert.equal(fields.parliament.seats[0].seats, 194);
  assert.equal(fields.parliament.seats[0].how, "all appointed");
  assert.deepEqual(demonym(PROFILE), { name: "Niger", adjective: "Nigerien" });
});

test("independence with nested brackets keeps the date", () => {
  const p = {
    Government: {
      Independence: {
        text: "24 August 1991 (from the Soviet Union; notable earlier dates: 1918 (ok))",
      },
    },
  };
  assert.deepEqual(extract(p).fields.independence, {
    date: "24 August 1991",
    event: "",
    from: "Soviet Union",
  });
});

/** @param {string[]} names @param {Partial<import("../../apps/factfile/blackout.js").Context>} [more] */
const ctx = (names, more = {}) => ({
  names,
  others: new Set(["france", "german"]),
  broad: true,
  water: false,
  ...more,
});
/** @param {ReturnType<typeof analyse>} parts */
const shown = (parts) =>
  parts.map((p) => (p.term ? `[${p.auto ? "x" : " "}${p.text}]` : p.text)).join("");

test("blackout: own names, place names, other countries and water", () => {
  const parts = analyse(
    "Lake Balaton, near Mount Kékes, like France, by the Black Sea",
    ctx(["Lake Balaton", "Balaton"]),
  );
  assert.equal(
    shown(parts),
    "[xLake Balaton], near [xMount Kékes], like [ France], by the [ Black Sea]",
  );
  assert.equal(parts[0].why, "own");
  assert.equal(parts.find((p) => p.text === "France")?.why, "country");
  assert.equal(parts.find((p) => p.text === "Black Sea")?.why, "water");
  const wet = analyse("by the Black Sea", ctx([], { water: true }));
  assert.equal(shown(wet), "by the [xBlack Sea]");
});

test("blackout: case matters, and plain capitalised words are left alone", () => {
  assert.equal(
    shown(analyse("an island state", ctx(["Island"], { broad: false }))),
    "an island state",
  );
  assert.equal(shown(analyse("Islamic law; OPEC member", ctx([]))), "Islamic law; OPEC member");
  // Names match whole words only: "German" is not found inside "Germany".
  assert.equal(shown(analyse("Germany", ctx(["German"], { broad: false }))), "Germany");
  assert.ok(isWater("Gulf of Guinea"));
  assert.ok(isWater("Africa"));
  assert.ok(!isWater("Sahara Desert"));
});

test("people and columns", () => {
  assert.equal(peopleText(12.66), "12.7 million");
  assert.equal(peopleText(0.4567), "457,000");
  assert.equal(balance([10, 10, 10, 10]), 2);
  assert.equal(balance([30, 5, 5]), 1);
});

test("parseRecord keeps only well-formed fields", () => {
  const rec = parseRecord(
    {
      code: "NE",
      names: { country: ["Niger", 3], people: ["Nigerien"] },
      fields: { climate: "hot\u0007", area: "big", city: { millions: 2.05, capital: "yes" } },
    },
    "NE",
  );
  assert.deepEqual(rec.names, ["Niger", "Nigerien"]);
  assert.equal(rec.fields.climate, "hot ");
  assert.equal(rec.fields.area, undefined);
  assert.deepEqual(rec.fields.city, { millions: 2.05, capital: false });
  assert.throws(() => parseRecord({ code: "NG" }, "NE"));
});

test("the built data: Factbook codes map to the right countries", () => {
  const index = JSON.parse(readFileSync("apps/factfile/data/index.json", "utf8"));
  // The Factbook's own codes differ from ISO codes: "ng" is Niger, "ni" Nigeria.
  assert.equal(index.countries.NE, "ng");
  assert.equal(index.countries.NG, "ni");
  assert.equal(index.countries.RS, "ri");
  assert.ok(parseIndex(index).codes.size >= 200);
  const niger = parseRecord(JSON.parse(readFileSync("apps/factfile/data/NE.json", "utf8")), "NE");
  assert.ok(niger.names.includes("Niger"));
  assert.ok(niger.fields.area > 1e6);
});

test("fitScale: shrinks to fit, grows into spare room up to the limit", () => {
  // Content of height 100·k in a room of 150.
  const fits = (/** @type {number} */ k) => 100 * k <= 150;
  assert.equal(fitScale(fits, 1, 1), 1, "no growing when not asked");
  assert.equal(fitScale(fits, 1, 1.4), 1.4, "the limit when even that fits");
  const tight = (/** @type {number} */ k) => 100 * k <= 120;
  const grown = fitScale(tight, 1, 1.4);
  assert.ok(grown > 1.19 && grown <= 1.2, `grown to ${grown}`);
  const shrunk = fitScale((k) => 100 * k <= 80, 1, 1.4);
  assert.ok(shrunk <= 0.8 && shrunk > 0.7, `shrunk to ${shrunk}`);
});

test("spread: spare room between fields, capped", () => {
  assert.equal(spread([10, 10, 10], 50, 100), 10);
  assert.equal(spread([10, 10, 10], 50, 4), 4);
  assert.equal(spread([10], 50, 100), 0, "one field stays at the top");
  assert.equal(spread([30, 30], 50, 100), 0, "no room, no gap");
});
