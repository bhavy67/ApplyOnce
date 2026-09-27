# Architecture notes

## Package dependencies

```text
apps/chrome-extension ──► adapters/generic ──► packages/field-mapper ──► packages/core
          │               adapters/workday ──► adapters/generic, field-mapper, core
          │               adapters/greenhouse ────────────────────────────► packages/core
          ├──► packages/field-mapper
          └──► packages/profile ──────────────────────────────────────────► packages/core
```

- `packages/core` has no internal dependencies. `packages/profile` uses core's canonical
  field definitions (to resolve a key such as `city` to `location.city`, and to validate).
- `packages/*` compile with `lib: ["ES2022"]` and no DOM or Node types, so using a browser
  API there is a type error. Keep them platform-independent.
- `adapters/*` may use DOM types. Site adapters build on the generic adapter (one way:
  `adapters/generic` never imports a site adapter) and never on each other, so Workday and
  Greenhouse logic can evolve independently.
- Only `apps/chrome-extension` may use `chrome.*` APIs.

## Canonical profile fields

`PROFILE_FIELDS` (`packages/core/profile-field.ts`) is the single source of truth for every
mappable profile field: key, path (`<section>.<property>`, always two levels), label, editor
section, value kind (`text`, `email`, `phone`, `url`, `years`, `year`, `boolean`, `choice`),
supported form field types, and choices. Consumers:

- profile editor (`ProfileForm.tsx`): sections, inputs, and error lookup are generated from it;
- validation (`validateProfile`): per value kind;
- value access (`getProfileValue`, `readStoredValue`, `updateProfileValue`): only through
  canonical paths, so arbitrary paths can never be read or written;
- mapper: field-type compatibility;
- Teach selector and saved-mapping validation: `PROFILE_FIELD_KEYS` filtered by field type.

Keys are stable identifiers stored in saved mappings: add keys, never rename or remove them
without a mapping migration. Aliases stay in `field-mapper/aliases.ts` (matching knowledge,
not field definitions), including `WEAK_ALIASES` for ambiguous words that may only reach
review.

## Profile schema and migration

`PROFILE_SCHEMA_VERSION` is 2. `migrateProfile` (`packages/profile`) is pure and
idempotent: version 2 gets missing sections filled with empty defaults; version 1 (Phases
1–4) has its education list, work modes, and employment types reduced to single primary
values, with every additional entry kept under `profile.legacy` (read-only, never filled).
Unknown versions return undefined and `ProfileRepository.load` throws, so data is refused
rather than overwritten. Loading never writes; the next save stores version 2.

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
 │  (isolated world,     │ ── PageScan ───────► │  analyze/review/fill │
 │   injected on click)  │                      └──────────┬───────────┘
 │  generic adapter:     │                                 │ MapFields
 │  scan, fill           │ ◄── FillFields ──┐              │ FillPage
 └──────────┬────────────┘  (approved pairs) │             │ (fields + approvals,
            │ GetProfileStatus               │             │  never values)
            ▼                                │             ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ service worker (message-handler.ts)                         │
 │  mapper (field-mapper) · value lookup (profile)             │
 └───────────────┬─────────────────────────────────────────────┘
                 ▼
       ┌───────────────────┐       ┌───────────┐
       │ ProfileRepository │ ────► │ IndexedDB │
       └───────────────────┘       └───────────┘
            ▲
            │ GetProfile (extension pages only)
 ┌──────────┴────────────┐
 │ extension pages       │   The profile page itself uses ProfileRepository directly
 └───────────────────────┘   (same origin as IndexedDB).
```

- **Responsibilities.** The content script inspects and fills the page. The service
  worker is the only context that reads storage for other contexts, runs the mapper, and
  decides which values go to the page. The popup handles user interaction and
  orchestrates (active tab, injection, scan, review).
- **Protocol.** All message types live in `src/messaging/protocol.ts` (`MessageType`,
  per-type response payloads, `MessageResult` envelope with typed error codes). Incoming
  messages are validated with `parseMessage`; malformed or unknown messages get an error
  result, never an exception. `src/messaging/send.ts` wraps `chrome.runtime.sendMessage`
  and `chrome.tabs.sendMessage`, turning "no receiver" and malformed responses into error
  results.
- **Profile exposure.** `GetProfile`, `MapFields`, `FillPage`, and the saved-mapping
  messages are accepted only when the sender's URL is an extension page. Content scripts share a renderer process with the
  web page, so they get `GetProfileStatus` (`{ hasData, valueCount }`) and, on Fill, a
  `FillFields` message with only the approved field/value pairs. `MapFields` returns
  `hasValue` flags, not values, so the popup never holds profile values either.
- **Fill checks.** For each approval the service worker re-runs the mapper on the field
  and requires the same profile field with status _mapped_ or _review_, checks the field
  type can hold it, and looks up the value. Anything else becomes a result (failed,
  unsupported, skipped) and is never sent to the page.
- **Build handshake.** `src/build-info.ts` exposes a build id injected by
  `vite.config.ts` (`__APPLYONCE_BUILD_ID__`) into the popup and service worker, which are
  built together. Analyze starts with `GetRuntimeInfo` (extension pages only; returns only
  the build id). A different id, or `unknown-message` from an older worker, yields the
  `extension-updated` failure ("Reload the extension"); no receiver yields
  `worker-unavailable`. Nothing is scanned or injected in either case.
- **Payload validation.** Every payload is structurally validated in `parseMessage`
  (`messaging/validate.ts`); malformed payloads are rejected.
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

Radios with the same name in the same form become one field.

**Adapter selection (Phase 8).** The content script picks the first site adapter whose
`detect` succeeds (Workday, Greenhouse), else the generic adapter, and reports it as the
platform. A detected adapter scans and fills only once it is implemented (currently
Workday); the Greenhouse stub's pages use the generic adapter. The generic scanner accepts
`ScanOptions` (`exclude`, `stableIdentity`, `postProcess`) and `fillFields` accepts a
`scan` function, so a site adapter reuses the whole engine and fills with the same scan it
analyzed with. The Workday adapter (`adapters/workday`) is detection (`detect.ts`), one
selectors file (`selectors.ts`), and a scan (`scan.ts`); see the README. Two platform-
neutral additions support it: `FormField.repeatedCount` (mapped to `repeated-question`,
never filled) and the `search-input` custom pattern (unsupported by the generic engine;
filled only by a site adapter's filler, see Phase 9). Independently,
the custom-dropdown engine never clicks a trigger or option whose whole name is a
navigation or submission action (Next, Continue, Save and Continue, Submit, Apply, Back, …).

**Search fields (Phase 9).** `fillFields` accepts a `fillCustom` hook: a site adapter's
filler for custom controls, tried before the generic engine (returning `undefined` hands
the field back). Without one, `search-input` stays unsupported, so generic pages are
unchanged. The Workday adapter's `fillWorkday` passes `fillSearchInput`
(`adapters/workday/src/search-input.ts`), which reuses the Phase 7 helpers exported from
`custom-select.ts` (`findListbox`, `readOptions`, `clickSequence`, `closePopup`,
`waitUntil`, `isSubmitter`, `isNavigationAction`) and the shared option matcher
(`findMatchingOption`), plus an "extends" guard that makes a suggestion containing the
value as whole words (e.g. "…, Ahmedabad") ambiguous. The scan marks an input with
`aria-autocomplete` list/both as `{ type: 'text', htmlType: 'search', custom: { pattern:
'search-input', supported } }`, supported when it declares aria-controls, aria-owns, or
aria-expanded; mapping and Teach Once treat it as a text field. Timing
(`DEFAULT_SEARCH_TIMING`, 4 s / 50 ms) is separate from dropdown timing. Confirmation
accepts `aria-selected`, a selected option in the list, a Workday selected-item pill
(`SELECTED_ITEM` in `selectors.ts`) inside the field's container, or the popup closed with
the field showing the suggestion; never just the typed text. Cleanup removes the typed text
only if the field still holds exactly it. No DOM reference outlives one fill call.

Phase 6 additions: a **wrapper label** rule (the only `for`-less `<label>` in the smallest
wrapper, at most three levels up, that contains only this field), `aria-hidden` text
excluded from labels, `readOnly` (`readonly` or `aria-readonly`), and `groupSize` for
checkboxes sharing a name in a form (a multi-option group, never filled). The mapper marks
read-only fields and checkbox-group options `unsupported`. Questions are normalized with
`normalizeQuestion` (required/optional markers removed); saved-mapping lookups also try the
key a field had before that change (`mappingKeyCandidates`), so earlier Teach Once
mappings keep working. `contenteditable` is deliberately not scanned.

Phase 7: custom single-select controls (`[role="combobox"]`, `[aria-haspopup="listbox"]`,
never a native select) are scanned in the same document-order pass. Each becomes one
`FormField` of type `select` with `custom: { pattern, supported }`
(`input-combobox` / `combobox` / `listbox-button`; supported when it has aria-controls,
aria-owns, or aria-expanded). Elements inside a custom control and controls marked
`aria-hidden="true"` are not fields. Labels exclude the control's own text and
self-references in aria-labelledby. The mapper is unchanged (an unsupported control is
`unsupported-control`). Filling goes through a separate path, `custom-select.ts`
(`fillCustomSelect`), while native selects keep `fillSelect`; option matching is shared
(`option-match.ts`). `fillFields` is async and sequential (`FormAdapter.fillFields` returns
a Promise), and the content script answers FillFields asynchronously. No option or DOM
reference is kept between analysis and fill: the control, listbox, and options are found
again each time.

`scanControls` returns the same fields with their current elements. Filling
(`fill-fields.ts`) re-scans, finds each field by id, and requires its type and name/id (or
label, when it has neither) to match what was analyzed, so re-rendered elements are found
and replaced or removed ones are reported as not found. See the README for per-type rules.

Scanner tests use HTML fixtures in `happy-dom` (dev dependency of `adapters/generic` only,
enabled per test file).

## Teach Once (saved mappings)

```text
popup Teach/Change ── SaveMapping { field, profileField, site } ──► service worker
                                                                   createMappingKeyParts(field)
                                                                   SavedMappingRepository.save
                                                                     (validates profile field key
                                                                      and field-type compatibility)
                      ◄── the field's updated ReviewedMapping (status "taught", no values)
profile page ── ListMappings / DeleteMapping / ClearMappings ──► service worker
```

- **Key** (`field-mapper/mapping-key.ts`): `v1|<fieldType>|q=<question>|c=<context>|i=<identifier>`.
  The question is the field's normalized label, else aria-label, else placeholder, else
  nearby text. Context is the fieldset legend when the question is the field's own label.
  The identifier (name, else id) is used only when there is no question. Exact equality
  only; no URL. The version prefix lets the format change later without misreading old
  keys (they simply stop matching).
- **Precedence** (`mapFields(fields, matcher, savedMappings)`): a saved mapping whose key
  matches and whose profile field the field type can hold → `taught` (`source: 'taught'`);
  otherwise the deterministic matcher (`source: 'automatic'`); otherwise `unknown`. Hidden,
  disabled, or incompatible fields are `unsupported` whatever the source.
- **Storage** (`storage/saved-mapping-repository.ts`): one `savedMappings` record
  (`{ version: 1, mappings }`) in the extension's IndexedDB, behind `LocalStore`. The
  repository is browser-independent code. It validates the profile field
  (`isProfileFieldKey`, no arbitrary paths) and field-type compatibility before writing,
  copies only known key-part fields, upserts by key (keeping `createdAt`), and serializes
  writes. An unknown stored version is refused, not discarded. The service worker is the
  only writer; if mappings can't be read, mapping falls back to automatic only.
- **Separation**: profile and saved mappings are separate records; clearing one never
  touches the other.
- **Access**: `SaveMapping`, `ListMappings`, `DeleteMapping`, `ClearMappings` are accepted
  only from extension pages. Content scripts can send `GetProfileStatus` and nothing else to
  the service worker.
- **Filling**: unchanged safety model. `FillPage` re-runs the precedence check with the
  current saved mappings, so only fields currently mapped/review/taught to the approved
  profile field are filled, and only their values are sent to the content script.

## Mapping pipeline

```text
adapter.getFields(page)   →  FormField[]              (content script, DOM-aware)
createFieldSignature      →  FieldSignature            (field-mapper, normalized text)
FieldMatcher.match        →  FieldMatch + confidence   (alias matcher, reasons per point)
saved mappings (by key)   →  taught, when a compatible saved mapping exists
mapFields                 →  one FieldMapping per field: mapped / review / taught / unknown / unsupported
getProfileValue           →  hasValue for review; the value itself only for approved fields
user review → FillPage → adapter.fillFields → FillResult per field → user submits
```

Only adapters touch the DOM. `FormField` carries metadata, not element references, and
does not capture values already typed into the page. Signal weights (`SIGNAL_WEIGHTS`,
`CONFLICT_MIN_SCORE`) and thresholds (`CONFIDENCE_THRESHOLDS`) are provisional.

## Conventions

- Future work is marked `TODO(phase-N)` with the phase number from the spec (§28).
- Confidence thresholds and signal weights are provisional (spec §19); they live in
  `CONFIDENCE_THRESHOLDS` (core) and `SIGNAL_WEIGHTS` (field-mapper).
- Every mapping change driven by a real form should come with a test.
- Logging goes through `logFailure` (extension), which records the operation and error
  type only, never error messages, profile values, or page content.
