// Rules every app's sheet follows (see "The clue sheets" in CONTRIBUTING.md).
// Run with `npm run test:unit`.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const apps = readdirSync("apps").filter((a) => existsSync(`apps/${a}/index.html`));

test("every app offers a transparent background", () => {
  for (const app of apps) {
    const html = readFileSync(`apps/${app}/index.html`, "utf8");
    assert.match(
      html,
      />\s*Transparent( background)?\s*</,
      `${app}: no "Transparent background" option`,
    );
  }
});

test("no app uses Fraunces, whose macrons sit over the next letter", () => {
  for (const app of apps) {
    for (const file of readdirSync(`apps/${app}`).filter((f) => /\.(html|css|js)$/.test(f))) {
      const text = readFileSync(`apps/${app}/${file}`, "utf8");
      // A comment may name it, to say why it isn't used.
      const code = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!/Fraunces/.test(code), `${app}/${file} uses Fraunces`);
    }
  }
});
