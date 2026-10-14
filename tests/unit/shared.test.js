// Unit tests for the pure parts of shared/. Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAlpha3 } from "../../shared/cldr.js";
import { parseHex, safeColour } from "../../shared/colour.js";
import { classifyLicence, licenceAllows, safeImageUrl } from "../../shared/commons.js";
import { rankCountries } from "../../shared/country-picker.js";
import { parseCsv } from "../../shared/net.js";
import { bareName, cleanText, norm } from "../../shared/text.js";

test("parseHex accepts #rrggbb, rrggbb and #rgb, rejects anything else", () => {
  assert.equal(parseHex("#FF8800"), "#ff8800");
  assert.equal(parseHex("f80"), "#ff8800");
  assert.equal(parseHex("zz"), null);
  assert.equal(safeColour("red", "#000"), "#000");
});

test("classifyLicence sorts licences into pd / by / sa / unknown", () => {
  assert.equal(classifyLicence("CC0", "").id, "pd");
  assert.equal(classifyLicence("Public domain", "").id, "pd");
  assert.equal(classifyLicence("CC BY 2.0", "").id, "by");
  assert.equal(classifyLicence("CC BY-SA 4.0", "").id, "sa");
  // Anything unrecognised is treated as the most restrictive.
  const unknown = classifyLicence("Fair use", "");
  assert.equal(unknown.id, "unknown");
  assert.ok(unknown.attribution && unknown.shareAlike);
});

test("licenceAllows: 'all' allows everything, stricter modes filter", () => {
  const sa = { licence: classifyLicence("CC BY-SA 4.0", "") };
  const pd = { licence: classifyLicence("CC0", "") };
  assert.ok(licenceAllows("all", sa));
  assert.ok(licenceAllows("pd", pd));
  assert.ok(!licenceAllows("pd", sa));
});

test("safeImageUrl only lets Wikimedia uploads through", () => {
  assert.equal(safeImageUrl("//upload.wikimedia.org/x.png"), "https://upload.wikimedia.org/x.png");
  assert.equal(safeImageUrl("javascript:alert(1)"), null);
  assert.equal(safeImageUrl("https://example.com/x.png"), null);
});

test("text helpers normalise names for matching", () => {
  assert.equal(norm("São Tomé"), "sao tome");
  assert.equal(bareName("The Gambia"), "gambia");
  assert.equal(cleanText("a‮b\u0000c", 10), "a b c");
});

test("parseCsv handles quotes, doubled quotes and CRLF", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","he said ""hi"""\r\n1,2'), [
    ["a", "b"],
    ["x, y", 'he said "hi"'],
    ["1", "2"],
  ]);
});

test("rankCountries: ISO code, then exact, then prefix, then substring", () => {
  const items = [
    { code: "DE", name: "Germany", alts: ["Deutschland"] },
    { code: "NE", name: "Niger", alts: [] },
    { code: "NG", name: "Nigeria", alts: [] },
    { code: "DZ", name: "Algeria", alts: [] },
  ];
  const opts = {
    forms: (/** @type {any} */ c) => [c.name, ...c.alts],
    code: (/** @type {any} */ c) => c.code,
    label: (/** @type {any} */ c) => c.name,
  };
  const names = (/** @type {string} */ q) => rankCountries(q, items, opts).map((c) => c.name);
  assert.deepEqual(names("ng"), ["Nigeria"]);
  assert.deepEqual(names("niger"), ["Niger", "Nigeria"]);
  assert.deepEqual(names("deutsch"), ["Germany"]);
  assert.deepEqual(names("eria"), ["Algeria", "Nigeria"]);
  assert.deepEqual(names(""), []);
});

test("parseAlpha3 reads CLDR's code mappings", () => {
  const m = parseAlpha3({
    supplemental: {
      codeMappings: { DE: { _alpha3: "DEU" }, "001": { _numeric: "001" }, XK: { _alpha3: "XKK" } },
    },
  });
  assert.equal(m.get("DE"), "DEU");
  assert.equal(m.has("001"), false);
  assert.throws(() => parseAlpha3({}), /unexpected/);
});
