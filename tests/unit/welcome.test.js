// Unit tests for the welcome window's text: every app has one, wired up
// under its own name. How the window opens and closes is checked in the
// smoke tests. Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { seenKey } from "../../shared/welcome.js";

const apps = readdirSync(new URL("../../apps/", import.meta.url));

test("every app has a welcome window, opened under its own name", async () => {
  for (const app of apps) {
    const { WELCOME } = await import(`../../apps/${app}/welcome.js`);
    assert.equal(typeof WELCOME.intro, "string", app);
    assert.ok(WELCOME.intro.length > 40, `${app}: intro says what the app makes`);
    // Short on purpose: no list of options, and a few sentences at most.
    assert.equal(WELCOME.options, undefined, `${app}: no options list`);
    assert.ok(WELCOME.intro.length < 260, `${app}: intro is short`);

    const main = readFileSync(new URL(`../../apps/${app}/main.js`, import.meta.url), "utf8");
    assert.ok(main.includes(`setupWelcome("${app}", WELCOME)`), `${app}: main.js opens it`);
    const html = readFileSync(new URL(`../../apps/${app}/index.html`, import.meta.url), "utf8");
    assert.ok(html.includes('href="../../shared/welcome.css"'), `${app}: links welcome.css`);
  }
});

test("each app remembers the welcome under its own key", () => {
  assert.equal(seenKey("climate"), "geo-apps.welcome.climate");
  assert.notEqual(seenKey("climate"), seenKey("rivers"));
});
