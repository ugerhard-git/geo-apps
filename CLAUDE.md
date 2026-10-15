# Working on this repository

Notes for Claude. How the apps and shared modules fit together, and the
security rules in detail, are in `README.md`; read it before changing code.

geo-apps is a set of small browser tools that make clue sheets for a geography
game: each app draws a picture (a map, a chart, a keyboard, a list of names)
that hints at a country without naming it. The site is published with GitHub
Pages.

## Pull requests

- **A pull request for every change.** Never push to `main`.
- **Check earlier pull requests first.** Before starting work for a new pull
  request, and before pushing to an existing branch, look at the state of
  every earlier pull request.
  - If one has been merged, start a new branch from the latest `main`. Never
    push to a branch whose pull request is already merged.
  - If one is still open, ask the owner whether to add to it or open a
    separate pull request.
- **The owner approves and merges.** Open pull requests; never merge them.
- **Plan first when asked.** When the owner asks to plan or discuss an idea,
  agree on it before building.
- Describe in each pull request what changed and how it was tested.

## Before every pull request

```sh
npm run check       # Prettier and ESLint
npm run test:unit
npm run build       # builds every app and the overview into _site/
npm run test:smoke  # Playwright browser tests
```

## Security

The owner's standing instruction: "Keep security in mind when building the
apps. Maybe do an audit after each major change." After a new app or a large
change, review it against these rules and say in the pull request what was
checked.

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
  pinned to a commit hash. Dependabot proposes updates.

## Data

- **Published data only.** Apps show data from a named, public source (Unicode
  CLDR, FineFreq, Wikipedia…), never figures the app works out itself. If no
  such source exists, discuss it with the owner instead of building the app.
- **Be upfront about its limits.** Old, undated or otherwise uncertain data is
  shown with a warning, on the sheet as well as in the app's Sources panel.
- **Precomputed data** lives in `apps/<app>/data/`, built by a script in
  `scripts/<app>/`. The JSON is written one entry per line, so a diff shows
  what changed; those folders are in `.prettierignore`. Data refreshed by a
  scheduled workflow arrives as a pull request for the owner to review, and
  the build fails rather than ship data that looks incomplete.

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
  more thing to learn; propose it to the owner first.
- **Keep the documentation true.** When the code changes, update its comments
  and `README.md` in the same pull request.

## Conventions

- Plain ES modules, no bundler. Each app is `apps/<slug>/` with `index.html`,
  `style.css`, `main.js` and its modules; shared code is in `shared/`.
- The overview page is built from each app's `<title>`, meta description and
  `geo-apps:tags` (the last tag is its kind: images, chart, maps, text or
  cards).
- New behaviour gets a unit test in `tests/unit/`; a new app also gets a smoke
  test.
- Update `README.md` when adding an app, a data source or a shared module.

## Working from the cloud workspace

- The smoke tests need Chromium's path:
  `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:smoke`.
- Wikipedia, jsDelivr and Google Fonts can't be reached from the shell;
  GitHub and npm can. To fetch other data, run a workflow on GitHub that
  commits it to a branch, and test pages against local copies of the fonts
  and CLDR files (npm packages).
- Use the `gh api` REST endpoints; GraphQL is blocked.
- Branches can't be deleted from here. List the ones that can go and ask the
  owner to delete them.
