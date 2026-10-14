# Vendored libraries

Kept in the repository rather than loaded from a CDN, so no third-party
server can change the code this app runs.

| File            | Library               | Source                                              | Licence                             |
| --------------- | --------------------- | --------------------------------------------------- | ----------------------------------- |
| `chart.umd.js`  | Chart.js 4.4.6        | npm `chart.js@4.4.6`, `dist/chart.umd.js`, unchanged | MIT (`chart.js-LICENSE.md`)         |

The npm tarball's checksum matched the registry's published `shasum`
(`da39b84ca752298270d4c0519675c7659936abec`) when it was added. To update:
`npm pack chart.js@<version>`, check the tarball against `npm view chart.js@<version> dist.shasum`,
copy `package/dist/chart.umd.js` here and update this table.
