// Unit tests for the pure parts of shared/. Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { overviewUrl } from "../../shared/back-link.js";
import { parseAlpha3, parseNumeric } from "../../shared/cldr.js";
import { parseHex, safeColour } from "../../shared/colour.js";
import { matchShape } from "../../shared/map-countries.js";
import {
  classifyLicence,
  licenceAllows,
  pickRenders,
  renderOfOriginal,
  safeImageUrl,
} from "../../shared/commons.js";
import { rankCountries } from "../../shared/country-picker.js";
import { parseCsv } from "../../shared/net.js";
import { bareName, cleanText, norm } from "../../shared/text.js";
import { boxOfPolys, pointInPolys } from "../../shared/world.js";

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

test("overviewUrl: only apps on the published site get a link back", () => {
  const at = (/** @type {string} */ url) => overviewUrl(new URL(url));
  const home = "https://ugerhard-git.github.io/geo-apps/";
  assert.equal(at("https://ugerhard-git.github.io/geo-apps/apps/geocards/"), home);
  assert.equal(at("https://ugerhard-git.github.io/geo-apps/apps/geocards/index.html"), home);
  // the overview itself, other hosts and the dev server: no link
  assert.equal(at("https://ugerhard-git.github.io/geo-apps/"), null);
  assert.equal(at("https://someone-else.github.io/geo-apps/apps/geocards/"), null);
  assert.equal(at("http://ugerhard-git.github.io/geo-apps/apps/geocards/"), null);
  assert.equal(at("http://127.0.0.1:8080/apps/geocards/"), null);
  assert.equal(at("https://example.com/apps/geocards/"), null);
});

test("parseNumeric reads ISO numeric codes, padded to three digits", () => {
  const m = parseNumeric({
    supplemental: {
      codeMappings: {
        DE: { _numeric: "276" },
        AF: { _numeric: "4" },
        "001": { _numeric: "001" },
        XK: {},
      },
    },
  });
  assert.equal(m.get("DE"), "276");
  assert.equal(m.get("AF"), "004");
  assert.equal(m.has("001"), false);
  assert.equal(m.has("XK"), false);
});

test("pointInPolys and boxOfPolys", () => {
  const square = [
    [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
        [4, 4],
      ],
    ],
  ];
  assert.equal(pointInPolys(2, 2, square), true);
  assert.equal(pointInPolys(5, 5, square), false); // in the hole
  assert.equal(pointInPolys(12, 2, square), false);
  assert.deepEqual(boxOfPolys(square), { w: 0, s: 0, e: 10, n: 10 });
});

test("matchShape finds a country's outline by code, then by name", () => {
  const ring = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => [i, i % 2]);
  const shapes = [
    { name: "Ashmore and Cartier Is.", id: "036", polys: [[ring(5)]] },
    { name: "Australia", id: "036", polys: [[ring(50)]] },
    { name: "Kosovo", id: "", polys: [[ring(5)]] },
  ];
  const numeric = new Map([["AU", "036"]]);
  const t = (/** @type {string} */ code, /** @type {string} */ name) => ({ code, name, alts: [] });
  assert.equal(matchShape(t("AU", "Australia"), numeric, shapes)?.name, "Australia");
  assert.equal(matchShape(t("AU", "Oz"), numeric, shapes)?.name, "Australia"); // the larger
  assert.equal(matchShape(t("XK", "Kosovo"), numeric, shapes)?.name, "Kosovo");
  assert.equal(matchShape(t("ZZ", "Nowhere"), numeric, shapes), null);
});

test("Commons renders: previews are never large originals", () => {
  const orig = "https://upload.wikimedia.org/wikipedia/commons/a/ab/K%C3%B6lner_Dom.jpg";
  const thumbOf = (/** @type {number} */ w) =>
    `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/K%C3%B6lner_Dom.jpg/${w}px-K%C3%B6lner_Dom.jpg`;
  assert.equal(renderOfOriginal(orig, 330), thumbOf(330));
  assert.equal(
    renderOfOriginal("https://upload.wikimedia.org/wikipedia/commons/a/ab/Plan.svg", 330),
    null,
  );
  assert.equal(renderOfOriginal("https://evil.example/wikipedia/commons/a/ab/X.jpg", 330), null);

  const big = { url: orig, width: 4000, mime: "image/jpeg" };
  // The usual reply: Commons gives the thumbnail.
  assert.deepEqual(pickRenders({ ...big, thumburl: thumbOf(330) }, 330, 1280), {
    thumb: thumbOf(330),
    full: thumbOf(1280),
  });
  // No thumbnail, or the original in its place: built from the original.
  assert.deepEqual(pickRenders(big, 330, 1280), { thumb: thumbOf(330), full: thumbOf(1280) });
  assert.deepEqual(pickRenders({ ...big, thumburl: orig }, 330, 1280), {
    thumb: thumbOf(330),
    full: thumbOf(1280),
  });
  // A small original is used as it is.
  assert.deepEqual(pickRenders({ url: orig, width: 300, mime: "image/jpeg" }, 330, 1280), {
    thumb: orig,
    full: orig,
  });
  assert.deepEqual(
    pickRenders({ url: orig, width: 900, mime: "image/jpeg", thumburl: thumbOf(330) }, 330, 1280),
    {
      thumb: thumbOf(330),
      full: orig,
    },
  );
});
