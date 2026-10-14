# Geo apps

Small browser tools that generate clues for a geography guessing game: road sign sheets, flag colour
charts, export treemaps, country outlines, satellite frames and more. Each app turns a country into
something to recognise without naming it, and exports it as an image.

**Live site:** https://ugerhard-git.github.io/geo-apps/

Everything runs in the browser. There is no backend and no build step for the apps themselves: each
one is plain HTML, CSS and JavaScript modules.

## Quick start

```sh
nvm use            # Node 22 (see .nvmrc)
npm install
npm run dev        # http://127.0.0.1:8080/
```

The apps are ES modules, which browsers refuse to load from `file://`, so always open them through
the dev server (or the published site) rather than double-clicking an `index.html`.

| Command              | What it does                                                         |
| -------------------- | -------------------------------------------------------------------- |
| `npm run dev`        | Serve the repository with a live overview page (`PORT=…` to move it) |
| `npm run check`      | Prettier check + ESLint — the same checks CI runs                    |
| `npm run format`     | Format everything with Prettier                                      |
| `npm run lint:fix`   | Apply ESLint's automatic fixes                                       |
| `npm test`           | Unit tests, then the browser smoke test                              |
| `npm run test:unit`  | Unit tests only (fast, no browser)                                   |
| `npm run test:smoke` | Load every app in Chromium and fail on any uncaught error            |
| `npm run build`      | Build the publishable site into `_site/`                             |

The smoke test needs a browser once: `npx playwright install chromium`. To use a Chrome you already
have instead, set `PW_CHROMIUM_PATH=/path/to/chrome`.

## Repository layout

```
apps/<slug>/        one folder per app — becomes /apps/<slug>/ on the site
shared/             modules used by several apps
site/               the overview page (template, styles, saved-keys panel)
scripts/            dev server, build, and app discovery
tests/unit/         node:test unit tests for the pure modules
tests/smoke.spec.js Playwright smoke test
.github/workflows/  CI and the GitHub Pages deployment
```

## Anatomy of an app

Every app folder has the same three entry files, plus modules that split the work by concern:

```
apps/roadsigns/
  index.html        markup, the Content-Security-Policy, and the <title>/<meta> the overview reads
  style.css
  main.js           state, event wiring and the panels — start reading here
  config.js         constants and tunables (limits, colours, category names)
  commons-data.js   fetching and cleaning data
  render.js         drawing the sheet on a canvas
```

`main.js` starts with a comment explaining the app's flow and which file does what. Most apps follow
the same split — `config.js` for settings, a data module for fetching, `render.js` for drawing — so
once you know one, the others read the same way. Pure logic (parsing, layout, colour maths) lives in
modules without DOM access so it can be unit-tested.

The "sheet" apps (road signs, plates, currency, endemics, statistics, …) share a page layout that
`shared/dom.js` relies on: a `#country` search input with a `#countryResults` list, a `#note` status
line, a `#bar` progress bar with `#loadLabel`, and the size controls `#frame`, `#customW`, `#customH`.

Each `index.html` keeps a strict Content-Security-Policy. If an app needs a new data source, add its
host to `connect-src` (or `img-src` for images), or the browser will block the request.

### Adding an app

1. Create `apps/<slug>/` with `index.html`, `style.css` and `main.js`
   (`<script type="module" src="main.js">`). Copy a similar app as a starting point.
2. Give `index.html` a `<title>`, a `<meta name="description">` and optionally
   `<meta name="geo-apps:tags" content="Source, kind">`. That is all the overview page needs; there is
   no list to register in.
3. Import shared code with relative paths, e.g. `import { $ } from "../../shared/dom.js"`.
4. `npm run dev`, then `npm run check` and `npm test` before pushing.

## Shared modules

All are documented with JSDoc, so editors show the docs and types on hover.

| Module              | What it is for                                                                     |
| ------------------- | ---------------------------------------------------------------------------------- |
| `util.js`           | `own`, `clamp`, a seeded `rng`                                                     |
| `text.js`           | Cleaning untrusted text, normalising names for matching, slugs                     |
| `colour.js`         | Parsing and validating colours typed by people                                     |
| `dom.js`            | `$`, segmented controls, the status note, progress bar, colour pickers, `debounce` |
| `sheet.js`          | The export canvas: frame size, canvas → blob, downloading                          |
| `net.js`            | `getJson`, `parseCsv`, shared endpoints (jsDelivr, Wikidata SPARQL)                |
| `cldr.js`           | Country names and ISO codes from Unicode CLDR                                      |
| `country-picker.js` | The type-ahead country search and its ranking                                      |
| `commons.js`        | Wikimedia Commons API, safe image URLs, licence classification                     |
| `images.js`         | Loading remote images so a canvas stays exportable                                 |
| `image-grid.js`     | Laying images out on a sheet with attribution lines                                |
| `blur.js`           | Blurring regions of an image                                                       |
| `wikipedia.js`      | Reading an article's infobox                                                       |
| `geo.js`            | TopoJSON decoding, distances, finding a country's mainland                         |
| `keys.js`           | API keys shared by all apps (see below)                                            |
| `back-link.js`      | The "Back to apps overview" link, shown only on the published site                 |

## API keys

Some apps can use a personal key (GeoCards: REST Countries; Export treemaps: OEC). Keys are never
stored in this repository or on the site. Instead, `shared/keys.js` keeps them in the visitor's
browser (`localStorage`), and because every app is served from the same origin, a key saved in one app
is available to all of them. Saving is opt-in: tick "remember" in an app, or use the **Saved API
keys** panel on the overview page, which also forgets them.

To add a service: add an entry to `SERVICES` in `shared/keys.js`, then use `getKey(id)`,
`saveKey(id, key)` and `forgetKey(id)` in the app. The overview panel picks it up automatically.

REST Countries keys are limited to allowed origins: add `https://ugerhard-git.github.io` (and
`http://127.0.0.1:8080` for local work) in your REST Countries account.

## Editor setup

Opening the folder in VS Code offers the recommended extensions (`.vscode/extensions.json`): ESLint,
Prettier, EditorConfig, Playwright Test, GitHub Actions and a spell checker. The workspace settings
format on save and apply ESLint fixes. **F5** starts the dev server and opens Chrome with the debugger
attached, so breakpoints in `apps/` and `shared/` work directly.

`jsconfig.json` gives IntelliSense from the JSDoc comments. Type checking is opt-in: add
`// @ts-check` at the top of a file to see type errors in it.

## Deployment

Every push to `main` runs CI (`.github/workflows/ci.yml`) and deploys the site
(`.github/workflows/pages.yml`), which runs `npm run build` and publishes `_site/`.

One-time setup on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
