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
site/               the overview page (template, styles, saved-keys panel,
                    external.json: pages on other sites listed there)
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

The "sheet" apps (road signs, plates, endemics, statistics, …) share a page layout that
`shared/dom.js` relies on: a `#country` search input with a `#countryResults` list, a `#note` status
line, a `#bar` progress bar with `#loadLabel`, and the size controls `#frame`, `#customW`, `#customH`.

Each `index.html` keeps a strict Content-Security-Policy. If an app needs a new data source, add its
host to `connect-src` (or `img-src` for images), or the browser will block the request.

### Adding an app

1. Create `apps/<slug>/` with `index.html`, `style.css` and `main.js`
   (`<script type="module" src="main.js">`). Copy a similar app as a starting point.
2. Give `index.html` a `<title>`, a `<meta name="description">`,
   `<meta name="geo-apps:tags" content="Source, kind">`, the topic it goes under on the overview,
   `<meta name="geo-apps:topic" content="land">` (one of `land`, `language`, `road`, `nature`,
   `numbers`: see `TOPICS` in `scripts/apps.mjs`), and the day it goes live,
   `<meta name="geo-apps:added" content="2026-11-10">`, which marks it "New" for three weeks. That is
   all the overview page needs; there is no list to register in.
3. Import shared code with relative paths, e.g. `import { $ } from "../../shared/dom.js"`.
4. Give it presets and a welcome window: see [Presets](#presets) and
   [Welcome window](#welcome-window).
5. `npm run dev`, then the checks in `CONTRIBUTING.md` before opening a pull request.

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
| `terrain-tiles.js`  | Elevation tiles (Shaded relief, Cross-sections): addresses, decoding, a cache      |
| `keys.js`           | API keys shared by all apps (see below)                                            |
| `back-link.js`      | The "Back to apps overview" link, on any web server (not from a file on disk)      |
| `fonts.js`          | Noto fonts per script from Google Fonts, loaded on demand (keyboards, baby names)  |
| `presets.js`        | The "Start from" menu and the two dice (see below), with `looks.js`                |
| `welcome.js`        | The welcome window shown on a first visit, and "How it works" (see below)          |

## Precomputed data: Landmarks

The Landmarks app reads one file per country from `apps/landmarks/data/`. They are
built by `scripts/landmarks/build-data.mjs`, which asks
[QLever](https://qlever.cs.uni-freiburg.de/wikidata) (a fast query engine over
Wikidata) for each country's buildings, monuments and natural sights, ranks them by
the number of Wikipedias with an article about them, and filters out what can't be
pictured as one sight (seas, regions, towns, tunnels). The rules are in
`scripts/landmarks/select.js`, with unit tests.

`.github/workflows/landmarks-data.yml` reruns it on the 1st of every month and opens
a pull request with whatever changed; it can also be started by hand under **Actions →
Landmarks data → Run workflow**. QLever has grown too slow for all countries to fit in
one job's time, so the work runs in six parts, one after another
(`.github/workflows/landmarks-part.yml`), each continuing from the previous part's data;
the whole run takes several hours. Each part stops starting new countries after 200
minutes, and a country not reached, or whose query fails, keeps its previous file. A
query QLever gives up on is not retried. For the pull request to be opened
automatically, enable **Settings → Actions → General → Allow GitHub Actions to create
and approve pull requests**; otherwise the workflow pushes a `landmarks-data-<date>`
branch and says so.

To rebuild a few countries locally: `node scripts/landmarks/build-data.mjs FR JP`
(or one part: `--part=2/6`).

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

## Precomputed data: Fact file

The Fact file app reads `apps/factfile/data/`, one file per country plus
`index.json`, built from the archived [CIA World Factbook](https://github.com/factbook/factbook.json)
(public domain). The Factbook stopped in February 2026, so the files are
built once, not on a schedule:

```
git clone --depth 1 https://github.com/factbook/factbook.json
node scripts/factfile/build-data.mjs factbook.json
```

`scripts/factfile/extract.js` turns each profile into short fields and a list
of names to black out: the country's own names, its people, cities, peaks,
lakes, rivers, regions and neighbours. It leaves out anything tied to a person
or to the last election, since the data no longer changes. The Factbook names
its files by its own codes ("ng" is Niger, "ni" Nigeria); the script matches
them to ISO codes through the [country-codes](https://github.com/datasets/country-codes)
table and stops if fewer than 200 countries come through.

## Precomputed data: Day length

The Day length app reads `apps/day-length/data/capitals.json`: each country's
capital, its position and its time zone, from [GeoNames](https://www.geonames.org/)
(CC BY 4.0). Capitals rarely move, so the file is built once and committed:

```
node scripts/day-length/build-data.mjs                  # downloads cities1000.zip
node scripts/day-length/build-data.mjs cities1000.txt   # or reads a copy
```

`scripts/day-length/parse.js` keeps the places GeoNames marks as capitals
(PPLC), the most populous one where a country has several, and drops any whose
time zone the JavaScript runtime doesn't know. The run stops if fewer than 200
capitals come through. Nothing else is looked up: sunrise, sunset and twilight
are worked out in the browser (`apps/day-length/sun.js`, NOAA's solar
equations), and summer time comes from the browser's own time-zone rules.

## Live data: Shaded relief and Cross-sections

Shaded relief and Cross-sections have no data of their own. They read
[Mapzen's Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) on
AWS Open Data straight from the browser: PNG tiles in the "Terrarium"
encoding, whose red, green and blue hold a height in metres. The tiles are
never shown; `shared/terrain-tiles.js` decodes each on a scratch canvas and
keeps the heights in a small cache, shared by both apps. The bucket allows any site to read them
(`Access-Control-Allow-Origin: *`), and no key is needed.

`apps/relief/terrain.js` does the rest: it picks the zoom whose tiles are as
sharp as the sheet (at most 100 tiles), shades the slopes under a light from
the north-west, and exaggerates heights so that the steepest twentieth of the
country's slopes reaches about 28°, which suits flat and mountainous
countries alike. "Colour by height" uses one of the schemes in
`apps/relief/config.js` or three custom colours; every scheme spans the same
heights, so a lowland country stays low-coloured. The sources the tiles are made from (SRTM, GMTED2010,
ETOPO1, EU-DEM and others) ask to be credited, so the sheet carries a credit
line by default and the Sources panel links to
[their attributions](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

Cross-sections draws the land along one straight line across a country, west
to east along a parallel or south to north along a meridian.
`apps/cross-sections/profile.js` places the line through the capital (from
the shared GeoNames city list), the centre of the country's area, or its
highest ground (found on a coarse grid of heights), then cuts it exactly where
it crosses the border of the mainland and nearby islands, so a bay, a lake or
a neighbour's land shows as a gap. About 900 points are read along it, from
tiles about as sharp as the points are close (at most 48 tiles). By default
every country shares one height scale, from sea level to 6,000 m (higher if
the line is), so a flat country looks flat; "Stretch the heights to fit" fills
the chart with the line's own heights instead, and the footnote says which.

## Live data: Place-name endings

Place-name endings uses the GeoNames list of places with at least 1,000
inhabitants that City dots and Cross-sections already load
(`shared/geonames.js`), this time with their names. Nothing is kept in the
repository, and nothing is fetched after start-up.

`apps/place-endings/endings.js` works out each country's typical endings
when the page opens:

- Each place counts once, by its longest word ("Nowy Dwór Mazowiecki" →
  "mazowiecki"), so districts of one city don't count twice.
- Every ending of two to six letters is counted, in each country and in the
  whole world.
- An ending is typical when at least 4 names (and 1.2% of them) end in it
  and the country uses it at least four times as often as the world. They are
  ranked by count × log(how much more often).
- A cut-off ending grows into the syllable most of its names share ("-rp" →
  "-torp"), and of an ending and a longer form of it only one is kept.

Only countries with at least 150 distinct place names are offered; with
fewer, the endings mean little. The sheet shows the endings as a cloud, or
twelve real towns with their ending in colour, picked at random (the same
ones for a country until "Other towns"), leaving out the ten largest cities
by default. The Sources panel explains the method, and the sheet says the
names come from GeoNames. The words are set in Literata rather than
Fraunces, whose bold draws the macron of ā, ū and ō over the next letter.

## Pages on other sites

The overview can also list pages that live elsewhere but help with the same
game, such as Unofficial (random unofficial Street View locations for
map-making.app). They're in `site/external.json`: an `id` (which names the
card's picture, `site/shots/<id>.webp`), a `title`, an `https://` address, a
`description`, `tags`, one of which is the kind of clue (`images`,
`chart`, `maps`, `text` or `cards`), a `topic` and an `added` date, as for an app. Their cards link to that address in the
same tab, like every card, and are marked "Another site ↗". The build stops
on a broken entry or an address that isn't `https://`. Their pictures are
made by hand, as below.

## The overview page

The apps come in sections by topic, each sorted by title. At the top is the
app of the day: the date alone picks it (`site/spotlight.js`), so everyone
sees the same app that day and every app gets its turn. "Show me another"
picks at random, apps not yet opened first. A card is marked "New" for three
weeks after its `geo-apps:added` date and "Not tried yet" once the visitor has
opened some app but not this one; the page knows from what each app's welcome
window remembers in the browser, and nothing is sent anywhere.

## Overview pictures

Each card on the overview shows a small picture of the app's sheet, from
`site/shots/<app>.webp`; `site/shots/shots.json` lists each picture's size
and description. They're made by `scripts/screenshots/take.mjs`, which opens
every app, runs the steps in `scripts/screenshots/recipes.mjs` (a country
chosen to show the app at its best, and a few settings) and saves the sheet,
at most 720 × 480 pixels.

The apps need live data, so the pictures are taken on GitHub: **Actions →
App screenshots → Run workflow**, optionally naming only some apps. The
workflow opens a pull request with the new pictures, to look at before
merging. Run it after an app's sheet changes its look. Apps with Commons
photos use public-domain files where there are enough, and otherwise files
whose credit line is on the sheet.

A picture can also be made by hand: export the sheet from the app, scale it
to fit 720 × 480, save it as `site/shots/<app>.webp` and mark its entry in
`shots.json` with `"custom": true`. The workflow then leaves it alone, unless
that app is named when the workflow is run. The Export treemaps picture is
always made this way, because its data source turns away requests from
GitHub's servers.

## Presets

Some apps open with an example already drawn and offer a **Start from** menu
at the top of the sidebar: examples (a country, a look and the app's own
options, chosen to show what the app can do) and looks (matched colour
schemes that keep the country). Two buttons give ideas: **Random country**
keeps the look, **Random look** keeps the country. Text the user typed
(caption, note) is never touched, and once a setting is changed by hand the
menu says "Custom (based on …)". Every app has them.

- In the apps with Commons photos (Endemics, Landmarks, Licence plates,
  Road signs), an example or "Random country" puts six photos on the
  sheet: openly licensed ones (public domain, CC0, CC BY) in the examples, the
  best-known first for landmarks, and one of each kind in turn for signs
  and plates (`pickSpread`). "Random country" only picks countries
  with enough to show where the app knows that in advance.
- Two apps have their own kind of look: Geo imagery's are imagery layers
  (night lights, relief), the OWID chart plotter's are chart backgrounds.
  The plotter's examples are a chart and the countries to compare
  (`examples.js`; its `presets.js` is the list of ready-made charts).

- `shared/looks.js` holds the looks, shared by every app. Unit tests check
  that text stays readable on each (contrast at least 7 : 1).
- `shared/presets.js` applies a preset by setting the page's own controls and
  firing the events a person would, so the app's usual handlers do the rest.
  Before an example, every setting goes back to how the page started.
- Each app's `presets.js` lists its examples (the first is drawn on opening)
  and maps a look onto its colour controls. Its `main.js` calls
  `setupPresets()` with those, the countries "Random country" may pick, and how
  to show a country; then `start()` once the country list has loaded. A unit
  test checks that every preset only names controls the page has.
- The page needs the "Start from" group (`#preset`, `#rndCountry`,
  `#rndLook`) at the top of its sidebar, and `shared/presets.css`.

## Welcome window

On a visitor's first visit to an app, a short window says what the app makes,
how to get started, and how the presets and dice work. "How it works", under
the app's title, opens it again. It's kept short on purpose, so it doesn't
put people off: no list of options, which are on the page to try.

- Each app's `welcome.js` holds what it makes, in a sentence or two.
  `shared/welcome.js` adds the parts every app shares: getting started and
  the presets. An app can replace those where they don't fit (the OWID
  plotter, Geo imagery).
- "Seen" is remembered per app in the browser (`geo-apps.welcome.<app>` in
  `localStorage`). When storage is blocked, the window opens on every visit.
- Its `main.js` calls `setupWelcome("<app>", WELCOME)` and its page links
  `shared/welcome.css`. A unit test checks both for every app, and a smoke
  test that the window opens once and comes back with "How it works".
- The overview pictures (`scripts/screenshots/take.mjs`) mark it as seen
  before a page loads, so it doesn't cover the controls.

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
  (see `shared/geonames.js` and `apps/rivers/data.js`). Elevation tiles must
  be PNGs of at most 2 MB and exactly 256 × 256 pixels (`apps/relief/tiles.js`).
  CSVs in the OWID chart plotter, fetched, uploaded or pasted, are capped at
  40 MB, and a chart name must look like one before an address is built from
  it (`apps/owid-chart-plotter/owid.js`).
- **No third-party scripts.** Libraries are kept in the repository (see
  `apps/owid-chart-plotter/vendor/`) instead of loaded from a CDN, because all
  apps share one origin, and with it the browser storage that can hold the
  REST Countries key.
- **API keys** live only in the visitor's browser, opt-in, and are only sent to
  their own service (`shared/keys.js`). Browser storage belongs to the whole
  `ugerhard-git.github.io` address, so any other site published from this
  GitHub account could read a saved key; keep that in mind before publishing
  code you haven't reviewed from the same account.
- **CI** runs with read-only permissions; only the Pages deploy job can publish,
  and only the Landmarks and Names data jobs can push (each to a new branch,
  via a pull request).
  Every action is pinned to a commit, not a movable tag, and Dependabot opens a
  pull request when one (or a dev tool) has an update.
- **Overrides in `package.json`:** `minimatch` is forced to version 11, which
  fixes a denial-of-service issue (GHSA-g3hv-75wg-m249), because ESLint still
  asks for version 10. Remove the override once ESLint asks for 11 itself.
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
| `apps/factfile/data/`             | CIA World Factbook | Public domain               |
| `apps/day-length/data/`           | GeoNames           | CC BY 4.0                   |
| `apps/owid-chart-plotter/vendor/` | Chart.js 4.4.6     | MIT (`chart.js-LICENSE.md`) |

Data, photos and fonts the apps fetch while running (Wikimedia Commons, Our
World in Data, REST Countries, Google Fonts and others) are not part of this
repository; each app's Sources panel names them and their licences.
