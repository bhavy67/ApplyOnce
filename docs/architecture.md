# Architecture notes

## Package dependencies

```text
apps/chrome-extension ──► adapters/* ──► packages/core
          │                                   ▲
          └──► packages/field-mapper ─────────┘
          └──► packages/profile
```

- `packages/core` and `packages/profile` have no internal dependencies.
- `packages/*` compile with `lib: ["ES2022"]` and no DOM or Node types, so using a browser
  API there is a type error. Keep them platform-independent.
- `adapters/*` may use DOM types. Each adapter depends only on `core`, never on another
  adapter, so Workday and Greenhouse logic can evolve independently.
- Only `apps/chrome-extension` may use `chrome.*` APIs.

## Local persistence

```text
packages/core      LocalStore<TSchema>          interface only
packages/profile   Profile, validateProfile     browser-independent
      │
apps/chrome-extension/src/storage
      indexeddb-store.ts     LocalStore implemented with IndexedDB
      profile-repository.ts  load (empty profile if none) / save / clear, version check
      │
apps/chrome-extension/src/profile-page   React UI; talks only to ProfileRepository
```

- The UI never touches IndexedDB directly. The repository is created in the page's
  `main.tsx` and passed in, so storage can be swapped (e.g. chrome.storage, or an encrypted
  store) without UI changes.
- Editing is in-memory; storage is written only on explicit save or clear.
- IndexedDB belongs to the extension origin. Content scripts cannot open it; they go through
  the service worker (see below).
- Tests run the real IndexedDB store against `fake-indexeddb` (dev dependency), each test
  with an isolated `IDBFactory`.

## Extension contexts and messaging

```text
 BROWSER TAB (page origin)                    EXTENSION (chrome-extension:// origin)

 ┌───────────────────────┐   tabs.sendMessage   ┌──────────────────────┐
 │ content script        │ ◄─── Ping/ScanPage ─ │ popup                │
 │  (isolated world,     │ ── PageScan ───────► │  Analyze this page   │
 │   injected on click)  │                      └──────────────────────┘
 │  generic adapter scan │
 └──────────┬────────────┘
            │ runtime.sendMessage: GetProfileStatus
            ▼
 ┌───────────────────────┐        ┌───────────────────┐       ┌───────────┐
 │ service worker        │ ─────► │ ProfileRepository │ ────► │ IndexedDB │
 │  message-handler.ts   │ ◄───── │ (Phase 1)         │ ◄──── │           │
 └───────────────────────┘        └───────────────────┘       └───────────┘
            ▲
            │ GetProfile (extension pages only)
 ┌──────────┴────────────┐
 │ extension pages       │   The profile page itself uses ProfileRepository directly
 └───────────────────────┘   (same origin as IndexedDB).
```

- **Responsibilities.** The content script inspects the page. The service worker is the
  only context that reads storage for other contexts. The popup handles user interaction
  and orchestrates (active tab, injection, scan).
- **Protocol.** All message types live in `src/messaging/protocol.ts` (`MessageType`,
  per-type response payloads, `MessageResult` envelope with typed error codes). Incoming
  messages are validated with `parseMessage`; malformed or unknown messages get an error
  result, never an exception. `src/messaging/send.ts` wraps `chrome.runtime.sendMessage`
  and `chrome.tabs.sendMessage`, turning "no receiver" and malformed responses into error
  results.
- **Profile exposure.** `GetProfile` returns the full profile only when the sender's URL
  is an extension page. Content scripts share a renderer process with the web page, so
  they only get `GetProfileStatus` (`{ hasData, valueCount }`). A later phase decides how
  the few values needed for filling reach the page; the default plan is for the extension
  side to map fields and send only those values.
- **Injection.** Only on user action, only into the active tab's top frame, only for
  http/https/file URLs. The popup pings first and injects `content.js` only when nothing
  answers. The script replaces its own listener if injected again, so there is never more
  than one. It does not modify the page, keep state, or observe DOM changes.
- **Browser independence.** `core`, `profile`, and `field-mapper` are unchanged in this
  respect: the DOM scanner lives in `adapters/generic`, messaging and `chrome.*` only in
  `apps/chrome-extension`.

## Field extraction (`adapters/generic`)

One pass over `input, select, textarea` under the page root, in document order, at page
level (no `<form>` required). Each supported control becomes a `FormField` (core):

- `id`: `id:<html id>`, `name:<name>`, `radio:<name>`, or `index:<n>`, with `~2`, `~3`
  suffixes for duplicates. Deterministic for the same DOM, so repeated scans agree.
- `type` (supported field type) and `htmlType` (the control's own type).
- `signals`: name, htmlId, label (`<label for>`/wrapping `<label>`, else
  `aria-labelledby`), ariaLabel, placeholder, autocomplete, nearbyText (fieldset legend,
  or preceding text only for unlabeled fields, never crossing into another field).
- `required` (`required` or `aria-required`), `disabled` (including a disabled fieldset),
  `visible` (`hidden` attribute, `display: none` up the tree, `visibility: hidden`, using
  `checkVisibility()` in Chrome).
- `form`: the enclosing form's `id`/`name`/`action` attributes, when present.
- `options`: select and radio choices. Which one is selected is not captured.

Radios with the same name in the same form become one field. Workday and Greenhouse
adapters still only detect their URLs; the content script reports the detected platform
but always extracts with the generic scanner for now.

Scanner tests use HTML fixtures in `happy-dom` (dev dependency of `adapters/generic` only,
enabled per test file).

## Mapping pipeline (target shape)

```text
adapter.getFields(page)  →  FormField[]            (adapters, DOM-aware)
createFieldSignature     →  FieldSignature          (field-mapper, normalized text)
FieldMatcher.match       →  FieldMatch + confidence (field-mapper)
mapFields                →  MappingResult           (mapped + unmapped field ids)
review → fill current step → user submits           (extension, later phases)
```

Only the adapter touches the DOM. `FormField` carries metadata, not element references, and
does not capture values already typed into the page.

## Conventions

- Future work is marked `TODO(phase-N)` with the phase number from the spec (§28).
- Confidence thresholds and signal weights are provisional (spec §19); they live in
  `CONFIDENCE_THRESHOLDS` (core) and `SIGNAL_WEIGHTS` (field-mapper).
- Every mapping change driven by a real form should come with a test.
- Logging goes through `logFailure` (extension), which records the operation and error
  type only, never error messages, profile values, or page content.
