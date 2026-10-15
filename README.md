# Geo apps

Small browser tools that generate clues for a geography guessing game: road sign sheets, flag colour
charts, export treemaps, country outlines, satellite frames and more. Each app turns a country into
something to recognise without naming it, and exports it as an image.

**Live site:** https://ugerhard-git.github.io/geo-apps/

Everything runs in the browser. There is no backend and no build step for the apps themselves: each
one is plain HTML, CSS and JavaScript modules.

Want to help? See [CONTRIBUTING.md](CONTRIBUTING.md) for how changes are made and reviewed.

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
4. `npm run dev`, then the checks in `CONTRIBUTING.md` before opening a pull request.

## Shared modules

All are documented with JSDoc, so editors show the docs and types on hover.

| Module              | What it is for                                                                     |
| ------------------- | ---------------------------------------------------------------------------------- |
| `util.js`           | `own`, `clamp`, a seeded `rng`                                                     |
| `text.js`           | Cleaning untrusted text, normalising names for matching, slugs                     |
| `colour.js`         | Parsing and validating colours typed by people                                     |
| `dom.js`            | `$`, segmented controls, the status note, progress bar, colour pickers, `debounce` |
| `sheet.js`          | The export canvas: frame size, canvas → blob, downloading                          |
| `net.js`            | `getJson`, size-capped `fetchBytes`/`getLargeJson`, `parseCsv`, shared endpoints   |
| `cldr.js`           | Country names and ISO codes from Unicode CLDR                                      |
| `country-picker.js` | The type-ahead country search and its ranking                                      |
| `commons.js`        | Wikimedia Commons API, safe image URLs, licences, file info for sheets             |
| `images.js`         | Loading remote images so a canvas stays exportable                                 |
| `image-grid.js`     | Laying images out on a sheet with attribution lines                                |
| `photo-sheet.js`    | Photos on a sheet, uncropped (`justified.js`), credits in full (`credits.js`)      |
| `blur.js`           | Blurring regions of an image                                                       |
| `wikipedia.js`      | Reading an article's infobox                                                       |
| `geo.js`            | TopoJSON decoding, distances, finding a country's mainland                         |
| `world.js`          | Country shapes from world-atlas (Natural Earth), point-in-polygon tests            |
| `projection.js`     | Web Mercator, the mainland of a country, bounds — for the map apps                 |
| `map-countries.js`  | CLDR countries matched to their world-atlas outlines, for the map apps             |
| `geonames.js`       | The GeoNames city list (all-the-cities): a bounds-checked decoder and loader       |
| `keys.js`           | API keys shared by all apps (see below)                                            |
| `back-link.js`      | The "Back to apps overview" link, shown only on the published site                 |
| `fonts.js`          | Noto fonts per script from Google Fonts, loaded on demand (keyboards, baby names)  |

## Precomputed data: Landmarks

The Landmarks app reads one file per country from `apps/landmarks/data/`. They are
built by `scripts/landmarks/build-data.mjs`, which asks
[QLever](https://qlever.cs.uni-freiburg.de/wikidata) (a fast query engine over
Wikidata) for each country's buildings, monuments and natural sights, ranks them by
the number of Wikipedias with an article about them, and filters out what can't be
pictured as one sight (seas, regions, towns, tunnels). The rules are in
`scripts/landmarks/select.js`, with unit tests.

`.github/workflows/landmarks-data.yml` reruns it on the 1st of every month (about 1½
hours) and opens a pull request with whatever changed; it can also be started by
hand under **Actions → Landmarks data → Run workflow**. For the pull request to be
opened automatically, enable **Settings → Actions → General → Allow GitHub Actions to
create and approve pull requests**; otherwise the workflow pushes a
`landmarks-data-<date>` branch and says so.

To rebuild a few countries locally: `node scripts/landmarks/build-data.mjs FR JP`.

## Precomputed data: Keyboard layouts

The Keyboard layouts app reads `apps/keyboards/data/layouts.json`: the Windows
keyboard layouts from Unicode CLDR 43 (the last release that published them;
Unicode License v3), plus the Korean, Japanese, Zhuyin and Cangjie legends that
Windows leaves to its input methods, entered by hand in
`scripts/keyboards/printed.js`. Which layouts a country uses comes from CLDR's
languages per territory, with exceptions in `scripts/keyboards/countries.js`
(the Netherlands on US-International, Poland on Polish Programmers…).

The layouts no longer change, so the file is built by hand and committed — see
the header of `scripts/keyboards/build-data.mjs`. Edit `countries.js` and
rebuild to change a country's layouts.

## Precomputed data: Letter frequencies

The Letter frequencies app reads `apps/letters/data/letters.json`. Its numbers
come from [FineFreq](https://github.com/Bin-2/FineFreq) (Binbin Xu, 2025;
CC BY 4.0), which publishes per-language character counts from FineWeb and
FineWeb2 — 96.6 trillion characters of Common Crawl text, 2013–2025. Nothing
is counted here: `scripts/letters/select.js` keeps each language's letters,
folds capitals into small letters and turns the counts into shares. Countries
get their official Latin-script languages from CLDR. The file is built by hand
(see the header of `scripts/letters/build-data.mjs`) and committed.

## Precomputed data: Baby names

The Baby names app reads `apps/names/data/names.json`, built from Wikipedia's
[List of most popular given names](https://en.wikipedia.org/wiki/List_of_most_popular_given_names)
(CC BY-SA 4.0) by `scripts/names/build-data.mjs`. Only whole countries are
kept — no "England, United Kingdom", cities or community lists. Every list
keeps what Wikipedia says about it: its year, whether it counts newborns or
the whole population, whether its source is unofficial, and the source it
cites. Lists from before 2015, or undated, are kept and flagged; the sheet
says so in its source lines.

`.github/workflows/names-data.yml` refreshes the file on the 2nd of each
month and opens a pull request when anything changed; it also runs by hand
(**Actions → Names data → Run workflow**). If the page's layout changes so
much that fewer than 60 countries parse, the run fails instead of opening a
pull request.

## API keys

GeoCards can use a personal REST Countries key. Keys are never
stored in this repository or on the site. Instead, `shared/keys.js` keeps them in the visitor's
browser (`localStorage`), and because every app is served from the same origin, a key saved in one app
is available to all of them. Saving is opt-in: tick "remember" in an app, or use the **Saved API
keys** panel on the overview page, which also forgets them.

To add a service: add an entry to `SERVICES` in `shared/keys.js`, then use `getKey(id)`,
`saveKey(id, key)` and `forgetKey(id)` in the app. The overview panel picks it up automatically.

REST Countries keys are limited to allowed origins: add `https://ugerhard-git.github.io` (and
`http://127.0.0.1:8080` for local work) in your REST Countries account.

## Security

The apps are static pages, so the main risks are data from the APIs or from
the user ending up as code, and third-party code running on the site. The
rules that keep that in check:

- **Data is text, never markup.** Everything from an API, a pasted CSV or a
  search box is put on the page with `textContent` or DOM calls, never
  `innerHTML`. HTML from Wikipedia is parsed into a detached document and only
  read as text. Links built from data always start with a fixed `https://` host.
- **Every page has a Content-Security-Policy** in its `<head>`:
  `default-src 'none'`, scripts only from the site itself, and `connect-src`
  listing exactly the APIs the app uses. Adding a data source means adding its
  host there.
- **Untrusted files are bounded.** Large downloads go through `fetchBytes`
  with a size cap, and parsers check every length, count and coordinate
  (see `shared/geonames.js` and `apps/rivers/data.js`).
- **No third-party scripts.** Libraries are kept in the repository (see
  `apps/owid-chart-plotter/vendor/`) instead of loaded from a CDN, because all
  apps share one origin, and with it the browser storage that can hold the
  REST Countries key.
- **API keys** live only in the visitor's browser, opt-in, and are only sent to
  their own service (`shared/keys.js`).
- **CI** runs with read-only permissions; only the Pages deploy job can publish,
  and only the Landmarks data job can push (to its own branch, via a pull request).
  Every action is pinned to a commit, not a movable tag, and Dependabot opens a
  pull request when one (or a dev tool) has an update.
- **Vendored code is checked against its release:** `vendor/chart.umd.js` is
  byte-identical to Chart.js 4.4.6 on npm.

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

## Licence

The code is released under the [MIT License](LICENSE).

The data files and the vendored library keep their own licences, which also
apply when you reuse them:

| Files                             | Source             | Licence                     |
| --------------------------------- | ------------------ | --------------------------- |
| `apps/keyboards/data/`            | Unicode CLDR 43    | Unicode License v3          |
| `apps/letters/data/`              | FineFreq (Xu 2025) | CC BY 4.0                   |
| `apps/names/data/`                | Wikipedia          | CC BY-SA 4.0                |
| `apps/landmarks/data/`            | Wikidata           | CC0                         |
| `apps/owid-chart-plotter/vendor/` | Chart.js 4.4.6     | MIT (`chart.js-LICENSE.md`) |

Data, photos and fonts the apps fetch while running (Wikimedia Commons, Our
World in Data, REST Countries, Google Fonts and others) are not part of this
repository; each app's Sources panel names them and their licences.
