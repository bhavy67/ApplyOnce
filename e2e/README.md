# Browser suites (real Chrome)

End-to-end suites for each phase. They load the unpacked extension from
`apps/chrome-extension/dist` into headless Chrome over the DevTools pipe and drive the popup,
profile page, and local fixture pages. They use fake data only, never submit forms, and never
sign in anywhere. Some suites also open public job boards read-only (e.g. a Workday job board).

```sh
pnpm build                       # build the extension
node e2e/scripts/setup.mjs       # once: fixture deps, fixture builds, old versions from git
node e2e/scripts/run-all.mjs     # all suites (or pass a filter, e.g. "phase15")
```

- `suites/`: one self-contained script per phase (`e2e-phaseN.mjs`, plus `-verify` suites).
- `fixtures/`: React / Vue / Angular fixture apps (sources only), built into `.out/fixtures`.
- `scripts/setup.mjs` builds the old versions the upgrade suites start from (Phase 4 and 5
  commits) with `git archive`, so the working tree is never touched.
- Output (Chrome profiles, screenshots, logs, builds) goes to `.out/`, which is git-ignored.

Requires Google Chrome at `/Applications/Google Chrome.app` (macOS), Node 22+, and pnpm.
Known: `e2e-phase2.mjs` has 2 checks for the Phase 2 popup stats and "View fields" button,
which the Phase 3 review list replaced; they fail by design and are kept as a record.
