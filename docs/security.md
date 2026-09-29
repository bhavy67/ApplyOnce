# Security and privacy model

ApplyOnce holds a person's most sensitive details (identity, contact, education, work
history) and uses them on third-party web pages. This document is the practical threat model
behind its design: what is protected, where the trust boundaries are, what attacks were
considered, how each is handled, and what risk remains. Phase 17 audited and hardened every
item below; the tests that back each mitigation are named in brackets.

**Core assumption:** the web page is hostile. Page JavaScript, the page DOM, page storage,
third-party scripts on the page, iframes, and the extension's own content script (which runs
in the page's renderer process) are all untrusted. Only extension pages (popup, profile page)
and the service worker are trusted.

## Assets

| Asset                                            | Where it lives                                | Who may read it                            |
| ------------------------------------------------ | --------------------------------------------- | ------------------------------------------ |
| Profile (all fields, records, stable record ids) | extension IndexedDB (`applyonce` → `profile`) | service worker, profile page               |
| Saved mappings (Teach Once)                      | extension IndexedDB (`savedMappings`)         | service worker, profile page (list)        |
| Record assignments                               | extension IndexedDB (`recordAssignments`)     | service worker, profile page (labels only) |
| Field fingerprints                               | computed per scan; stored in assignments      | service worker, extension pages            |
| Approved value for one approved field            | sent to the page at Fill                      | the page (by design, see below)            |

Nothing is stored anywhere else: no `chrome.storage`, no page `localStorage`/cookies, no
backend, no analytics, no telemetry, no network requests at all (the production bundle has no
`fetch`, XHR, WebSocket, or beacon code; checked by `pnpm security`).

## Trust boundaries

```text
 UNTRUSTED                                        TRUSTED (chrome-extension:// origin)
 ┌─────────────────────────────────────┐          ┌───────────────────────────────────┐
 │ web page JS, DOM, storage, iframes  │          │ popup · profile page              │
 │ ┌─────────────────────────────────┐ │  scan /  │   (all privileged messages)        │
 │ │ content script (isolated world) │◄├──fill────┤ service worker                     │
 │ │  answers scans, fills approved  │ │ requests │   (profile, mappings, assignments) │
 │ │  pairs; asks the worker nothing │ │          │                                    │
 │ └─────────────────────────────────┘ │          │ IndexedDB (extension origin)       │
 └─────────────────────────────────────┘          └───────────────────────────────────┘
```

1. **Page ↔ extension.** No `externally_connectable`, no `web_accessible_resources`, no
   `onMessageExternal`, no `window.postMessage` listener. Page scripts have no channel to
   the extension at all. [e2e-phase17: page probes; security.test.ts source audit]
2. **Content script → service worker.** Refused for every message (Phase 17 removed the last
   exception, the profile status; the popup asks for it instead). The check is the sender
   URL: only this extension's own origin (`chrome-extension://<id>/`, trailing slash
   included, so no prefix trick matches). [security.test.ts: unauthorized senders]
3. **Extension → content script.** The content script accepts messages only from this
   extension (`sender.id`), validates every payload, and only answers scans and fills.
4. **Content script → extension (responses).** Treated as untrusted input: scan results are
   validated field by field before use; fill results must be a known status with a short
   message, or they are replaced by "The page did not respond".

## Attack surface and mitigations

| #   | Threat                                             | Mitigation                                                                                                                                                                                                                                                                                                                                                                     | Residual risk                                                                                                                                                                 |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Page tries to read the profile                     | No page-reachable channel; profile only in extension IndexedDB; only extension pages may call `GetProfile`                                                                                                                                                                                                                                                                     | none known                                                                                                                                                                    |
| B   | Page JS messages the extension                     | Not possible without `externally_connectable` (verified in Chrome: `sendMessage` gets no answer, extension files fail to load)                                                                                                                                                                                                                                                 | none known                                                                                                                                                                    |
| C   | Content script tricked into asking for the profile | Content script never sends to the worker; the worker refuses all web-page senders                                                                                                                                                                                                                                                                                              | a fully compromised renderer could forge messages, but the worker still refuses them                                                                                          |
| D   | Indirect invocation (crafted payloads)             | Strict validators: unknown keys rejected, bounded sizes, canonical profile targets only, strict record ids, page keys = origin + path only, fingerprints refused in fill instructions                                                                                                                                                                                          | —                                                                                                                                                                             |
| E   | Stale extension code                               | Build-id handshake before Analyze and before Fill; stale worker → reload message, nothing scanned or filled                                                                                                                                                                                                                                                                    | —                                                                                                                                                                             |
| F   | DOM redirects an approved fill                     | Service worker re-scans and compares each field's identity; the page then re-checks name, id, question, type, record, repeat count, state, right before each field                                                                                                                                                                                                             | see race below                                                                                                                                                                |
| G   | Field changed just before filling                  | Same checks, run again immediately before each field (Phase 17: per-field re-scan and a connected-element check)                                                                                                                                                                                                                                                               | a change in the few milliseconds between the worker's re-scan and the page's check that alters only a field's context (e.g. a fieldset legend) and nothing else is not caught |
| H   | Widget triggers submission or navigation           | ApplyOnce never clicks submit/navigation controls (whole-name list incl. Next, Continue, Save, Save and Continue, Submit, Apply, Finish, Back); triggers that are submit buttons get no click; options that are submit buttons or leaving links are refused; no Enter key is ever sent; a page guard cancels form submissions and script clicks on leaving links during a fill | page code that calls `form.submit()` or assigns `location` directly cannot be intercepted (see below)                                                                         |
| I   | Corrupted profile storage                          | Refused as a whole (wrong types, huge values, bad or duplicate record ids, unknown versions); never repaired, dropped, or overwritten; profile page shows "could not be loaded"                                                                                                                                                                                                | the user must clear it to continue                                                                                                                                            |
| J   | Malformed mappings / assignments                   | Every entry validated on read; one bad entry refuses the record; autofill continues without them; clearing stays possible                                                                                                                                                                                                                                                      | —                                                                                                                                                                             |
| K   | Sensitive data in logs                             | One logger (`logFailure`): operation + sanitized error type only; no messages, stacks, objects; a test forbids any other logging in production code                                                                                                                                                                                                                            | —                                                                                                                                                                             |
| L   | Sensitive URLs                                     | Assignments keep origin + path only (no credentials, query, fragment); saved mappings keep a hostname only; views show host and path                                                                                                                                                                                                                                           | a secret inside a URL path itself is kept (it is the page's identity)                                                                                                         |
| M   | Page observes injected values                      | The approved value of the approved field becomes page-visible (inherent to autofill); nothing else is written to the page (no attributes, globals, storage)                                                                                                                                                                                                                    | the page sees what is filled into its own form, by design                                                                                                                     |
| N   | Misleading labels / options                        | Matching is deterministic and whole-text; a value match that conflicts with another option's visible text, or duplicate names, is ambiguous and fails; hostile labels are rendered as text                                                                                                                                                                                     | a page can always label a field misleadingly; approval is per field, shown with the page's own label                                                                          |

### What page JavaScript can inherently observe

Filling a form puts a value into the page. Page scripts can read that control's value, listen
to the `input`/`change`/`click` events ApplyOnce dispatches, and watch the DOM. So **the
approved value for the approved field is observable by the page, as if the user had typed
it.** ApplyOnce guarantees only that nothing more crosses: no unrelated profile values, no
records, no record ids, fingerprints, mappings, or assignments, and no hidden attributes or
globals. Page monkey-patches (value setters, `dispatchEvent`) do not see ApplyOnce's own
calls, because the content script runs in Chrome's isolated world; the resulting events and
values are still visible, as above. [e2e-phase17: hostile page]

### Direct page-script actions

JavaScript on the page can call `form.submit()`, assign `location`, or navigate in any way it
likes, including in response to a value changing. Those do not always produce an
interceptable event, and **ApplyOnce cannot block arbitrary page code.** Its responsibility
is to never trigger such actions itself; when a page does it anyway, the fill of that page
ends and the remaining fields are reported as failed. Browser tests show both: a
`requestSubmit()` on change is stopped, and a `location` assignment on change navigates away.

## Permissions

`activeTab` + `scripting` only: injection happens only after the user clicks Analyze, into
the active tab's top frame. No host permissions (not `<all_urls>`, not Workday or Greenhouse
hosts), no content scripts declared in the manifest, no background scanning, no
`web_accessible_resources`, no `externally_connectable`, no `storage` permission (IndexedDB
needs none). The extension-page CSP is explicit and strict:
`script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
`pnpm security` fails the build check if any of this changes.

## Build and supply chain

- `pnpm security` (part of `pnpm check`): manifest keys and permissions, CSP, shipped file
  types, no source maps, no `fetch`/XHR/WebSocket/beacon/`eval`/`new Function`/remote script
  code, only known text URLs, no test markers (fake names, emails, record ids, localhost,
  fixtures), no install scripts in workspace packages or dependencies, `.gitignore` covers
  `dist/` and `e2e/.out/`.
- Production dependencies: `react`, `react-dom` only. `pnpm audit` (all and production) and
  `npm audit` for the test-only fixtures reported no known vulnerabilities (September 2026).
- `e2e/` is test-only: its fixtures are never bundled (checked in the build), and its output
  is git-ignored.

## Real-site verification boundary

- Workday: only public job-board pages were analyzed read-only; application forms require
  sign-in, which is never attempted.
- Greenhouse: one public posting was analyzed read-only, and its form was filled once with
  fake data in headless Chrome with every write request from the page blocked (one analytics
  `POST` was attempted and blocked) and never submitted.
- The Phase 17 security suite contacts no real site; any non-local request would be blocked
  and fail the suite.

Fixture results are not production security validation of Workday or Greenhouse.
