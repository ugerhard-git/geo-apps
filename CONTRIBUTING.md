# Contributing to geo-apps

Thanks for helping! geo-apps is a set of small browser tools that make clue
sheets for a geography game: each app draws a picture (a map, a chart, a
keyboard, a list of names) that hints at a country without naming it.

`README.md` explains how the apps and shared modules fit together; this guide
covers the rules every change follows.

## Getting started

```sh
nvm use            # Node 22 (see .nvmrc)
npm install
npm run dev        # http://127.0.0.1:8080/
```

The smoke tests need a browser once: `npx playwright install chromium`, or
set `PW_CHROMIUM_PATH` to a Chrome you already have.

## Proposing a change

- **Small fixes:** open a pull request directly.
- **A new app or a larger change:** open an issue first, so the idea can be
  agreed on before you build it. For a new app, say which published source
  its data would come from (see [Data](#data)).
- **One change per pull request.** Describe what changed and how you tested
  it; for visual changes, add a screenshot.
- The owner reviews and merges every pull request.

## Before every pull request

```sh
npm run check       # Prettier and ESLint
npm run test:unit
npm run build       # builds every app and the overview into _site/
npm run test:smoke  # Playwright browser tests
```

CI runs the same checks.

## Security

The full rules are in the Security section of `README.md`. In short:

- **The Content-Security-Policy stays strict.** Every page keeps
  `default-src 'none'` and `script-src 'self'`, and `connect-src` lists
  exactly the hosts the app fetches from. Do not loosen it to make a change
  work.
- **Data is text, never markup.** Anything from an API, a data file or the
  user goes on the page with `textContent` or DOM calls, never `innerHTML`.
  Links built from data start with a fixed `https://` host or are checked
  against `^https?://`; colours go through `safeColour`.
- **Untrusted input is bounded.** Downloads and files are size-capped, and
  parsers check every field before use.
- **No third-party scripts.** Libraries are kept in the repository, not loaded
  from a CDN.
- **Workflows** run with the fewest permissions they need, and every action is
  pinned to a commit hash.

After a new app or a large change, review it against these rules and say in
the pull request what was checked.

**Found a security problem?** Please report it privately through the
repository's Security tab ("Report a vulnerability"), not in a public issue.

## Data

- **Published data only.** Apps show data from a named, public source (Unicode
  CLDR, FineFreq, Wikipedia…), never figures the app works out itself.
- **Its licence must allow sharing it.** Data kept in the repository keeps its
  own licence; add it to the table in the Licence section of `README.md`.
- **Be upfront about its limits.** Old, undated or otherwise uncertain data is
  shown with a warning, on the sheet as well as in the app's Sources panel.
- **Precomputed data** lives in `apps/<app>/data/`, built by a script in
  `scripts/<app>/`. The JSON is written one entry per line, so a diff shows
  what changed; those folders are in `.prettierignore`. Data refreshed by a
  scheduled workflow arrives as a pull request for review, and the build fails
  rather than ship data that looks incomplete.

## The clue sheets

- **Nothing gives the answer away** unless the user asks: not the sheet, not
  the file name (exports use a hash unless naming is on). Options that reveal
  the answer are marked "reveals".
- The preview and the export are drawn by the same code, from `render.js`.
- Sheets in any script need the right fonts: `shared/fonts.js` loads the Noto
  family per script on demand, and the canvas must wait for it.

## Interface text

Plain language for non-technical users, in sentence case ("Name the layout",
not "Name The Layout"), with no jargon. This covers labels, hints, messages,
errors and the Sources panels: say what happened and what to do ("Couldn't
load the keyboards. Check your connection and reload."), not how the code
works.

## Code for people

The code is read by the owner and by developers who don't know the project.
Write it so they can follow it without help.

- **Clear before clever.** Choose the plain version over the shortest or
  fastest one, unless the speed matters and a comment says why.
- **Every file explains itself.** Start with a short comment on what the file
  does; in an app's `main.js`, also the flow from loading to export and what
  each of its modules is for.
- **Comments say why, not what.** Explain decisions, sources and edge cases
  ("Capital ß is ẞ, not SS"); the code already shows what it does.
- **Small modules with one job each:** data, drawing and the page are kept
  apart, and functions that only compute have no side effects, so they can be
  tested.
- **Names a reader understands:** whole words, matching the interface where
  possible, no private abbreviations.
- **JSDoc types** on exported functions and shared data shapes, so editors can
  help.
- **Follow the existing patterns.** Reuse `shared/` before writing something
  new, and move code there once a second app needs it.
- **No new tools without a reason.** Every dependency or build step is one
  more thing to learn; propose it in an issue first.
- **Keep the documentation true.** When the code changes, update its comments
  and `README.md` in the same pull request.

## Conventions

- Plain ES modules, no bundler. Each app is `apps/<slug>/` with `index.html`,
  `style.css`, `main.js` and its modules; shared code is in `shared/`. See
  "Adding an app" in `README.md`.
- The overview page is built from each app's `<title>`, meta description and
  `geo-apps:tags` (the last tag is its kind: images, chart, maps, text or
  cards).
- New behaviour gets a unit test in `tests/unit/`; a new app also gets a smoke
  test.
- Update `README.md` when adding an app, a data source or a shared module.

## Licence

By contributing, you agree that your contributions are released under the
[MIT License](LICENSE).
