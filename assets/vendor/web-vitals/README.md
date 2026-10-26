# web-vitals

Vendored official `web-vitals` npm package, version **6.2.3**.

- Source: <https://www.npmjs.com/package/web-vitals/v/6.2.3>
- Upstream: <https://github.com/GoogleChrome/web-vitals>
- Files: unchanged `dist/web-vitals.js` and `LICENSE` from `web-vitals-6.2.3.tgz`.
- License: Apache-2.0; see [LICENSE](LICENSE).

The basic module is used without attribution. Only metric name, numeric value,
and rating are sent by `assets/js/analytics-performance.js`; element selectors,
resource URLs, metric identifiers, and navigation entries are not sent.

To update, obtain a reviewed stable package using `npm pack web-vitals@VERSION
--ignore-scripts` and replace these two upstream files, then update this note.
