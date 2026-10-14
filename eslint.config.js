// ESLint "flat" configuration: https://eslint.org/docs/latest/use/configure/
//
// Formatting is Prettier's job, so only rules that find bugs are enabled here
// (eslint-config-prettier switches off anything that would fight it).

import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "_site/", "test-results/", "playwright-report/", "**/vendor/"] },

  js.configs.recommended,

  // The apps, the shared modules and the overview page run in the browser.
  {
    files: ["apps/**/*.js", "shared/**/*.js", "site/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
    },
  },

  // Chart.js is loaded as a classic <script> before the app's module.
  {
    files: ["apps/owid-chart-plotter/**/*.js"],
    languageOptions: { globals: { Chart: "readonly" } },
  },

  // Build scripts, the dev server and the tests run in Node.
  {
    files: ["scripts/**/*.mjs", "tests/**/*.js", "*.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },

  {
    rules: {
      // Unused code is usually a leftover from a refactor; flag it, but allow
      // an intentionally unused argument or caught error to be named `_…`.
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", caughtErrors: "none", varsIgnorePattern: "^_" },
      ],
      // Catch accidental globals and typos in names.
      "no-undef": "error",
      // Prefer `const` where a binding is never reassigned; it makes data flow obvious.
      "prefer-const": "warn",
      eqeqeq: ["warn", "smart"],
      "no-var": "error",
    },
  },

  prettier,
];
