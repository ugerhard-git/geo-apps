# Working on this repository

Notes for Claude. The project's rules are in `CONTRIBUTING.md`, and how the
apps and shared modules fit together is in `README.md`; read both before
changing code and follow them. This file only adds how to work with the
owner.

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
  agree on it before building. The same goes for a new app whose data has no
  published source: discuss it instead of building it.

## Security

The owner's standing instruction: "Keep security in mind when building the
apps. Maybe do an audit after each major change." After a new app or a large
change, review it against the security rules in `CONTRIBUTING.md` and say in
the pull request what was checked.

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
