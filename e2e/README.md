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
  `e2e-phase16.mjs` runs one shared fixture matrix on generic, Workday-structured, and
  Greenhouse-structured pages, and a fake-data fill of one public Greenhouse posting with
  every write request from the page blocked (never submitted).
- `fixtures/`: React / Vue / Angular fixture apps (sources only), built into `.out/fixtures`.
- `scripts/setup.mjs` builds the old versions the upgrade suites start from (Phase 4 and 5
  commits) with `git archive`, so the working tree is never touched.
- Output (Chrome profiles, screenshots, logs, builds) goes to `.out/`, which is git-ignored.

Requires Google Chrome at `/Applications/Google Chrome.app` (macOS), Node 22+, and pnpm.
Known: `e2e-phase2.mjs` has 2 checks for the Phase 2 popup stats and "View fields" button,
which the Phase 3 review list replaced; they fail by design and are kept as a record.

## Safety of the harness (Phase 17 review)

- Fake data only (`Jane Doe`, `jane.doe@example.com`, …); no real credentials or secrets
  anywhere in `e2e/`. Password inputs in fixtures are empty and exist to check they are
  ignored.
- Local fixtures are served from `127.0.0.1`; their forms `preventDefault()` every submit
  and count it, so a fixture can never submit anywhere.
- Real sites contacted, all read-only and named at the top of each suite:
  `workday.wd5.myworkdayjobs.com/Workday` (Phases 8, 9, 16: public job board, Analyze only)
  and one public Greenhouse posting (Phase 15: Analyze only; Phase 16: one fake-data fill
  with every write request from the page blocked through the DevTools Fetch domain, never
  submitted, no upload).
- `e2e-phase17.mjs` (security) contacts no real site: it blocks every request that is not
  to the local fixture server or the extension, and fails if any was attempted.
- All output (Chrome profiles, logs, screenshots, builds) is in the git-ignored `.out/`.
