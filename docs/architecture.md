# Architecture notes

## Package dependencies

```text
apps/chrome-extension ──► adapters/generic ──► packages/field-mapper ──► packages/core
          │               adapters/workday ──► adapters/generic, field-mapper, core
          │               adapters/greenhouse ──► adapters/generic, field-mapper, core
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

`packages/core/profile-field.ts` is the single source of truth for every mappable profile
field. `PROFILE_FIELDS` holds scalar fields: key, path (`<section>.<property>`, or
`education[0].<property>` for a primary-record field), label, editor section, value kind
(`text`, `email`, `phone`, `url`, `years`, `year`, `month`, `boolean`, `choice`), supported
form field types, and choices. `PROFILE_RECORD_COLLECTIONS` / `PROFILE_RECORD_FIELDS` hold
repeatable records (Phase 10): per field its collection, record property, label, kind, form
field types, `teachable`, and `primaryKey` (the scalar key that is this field of record 0).
The four primary education scalars are built from their record definitions
(`primaryRecordField`), so there is one definition and one stored value.

**Targets.** A mapping points to a `ProfileTarget`: a scalar key, or a record reference
`<collection>[<index>].<field>`. `resolveProfileTarget` is the only interpreter: it accepts
scalar keys and record references matching a strict pattern with a defined field and an
index below `MAX_PROFILE_RECORDS` (20), canonicalizes `education[0].<field>` to its scalar
key, and returns label ("Education 2 → Institution"), path, kind, and field types. Anything
else is rejected; targets are never evaluated as object paths. Consumers:

- profile editor (`ProfileForm.tsx`): sections, inputs, and error lookup are generated from it;
- validation (`validateProfile`): per value kind;
- value access (`getProfileValue`, `readStoredValue`, `updateProfileValue`, and the record
  operations `addRecord`, `removeRecord`, `moveRecord`, `updateRecordValue`): only through
  resolved targets, so arbitrary paths can never be read or written;
- mapper: field-type compatibility (saved targets re-resolved on every use); the automatic
  matcher only produces scalar keys;
- Teach selector (`teachOptions(fieldType, recordCounts)`) and saved-mapping validation.

Keys are stable identifiers stored in saved mappings: add keys, never rename or remove them
without a mapping migration. Aliases stay in `field-mapper/aliases.ts` (matching knowledge,
not field definitions), including `WEAK_ALIASES` for ambiguous words that may only reach
review.

## Profile schema and migration

`PROFILE_SCHEMA_VERSION` is 4 (Phase 13: every record has a stable `id`). `migrateProfile` (`packages/profile`) is pure and
idempotent, and chains steps: version 1 (Phases 1–4) → 2 reduces the education list, work
modes, and employment types to single primary values, keeping additional entries under
`profile.legacy`; version 2 (Phases 5–9) → 3 turns the primary education object into
`education[0]` (followed by any legacy education entries; blank data creates no record),
moves `experience.workHistory` to `workExperience`, and adds `certifications: []`. Current
employment is untouched and nothing is fabricated. Version 3 → 4 only adds record ids:
`withRecordIds` (`record-ids.ts`, also run on every load) keeps valid unique ids and gives any
other record `derivedRecordId` ("m-" + 16 hex of an FNV hash of collection, stored position,
and content) — deterministic, so all contexts agree before the first save, and never
recomputed once stored. New records get `crypto.randomUUID()` (`addRecord`, and a primary
field written with no record yet). Missing sections get empty defaults and non-object
records are dropped. Unknown or newer versions return
undefined and `ProfileRepository.load` throws, so data is refused rather than overwritten.
Loading never writes; the next save stores version 4. Ids are not values: `isBlankRecord`
and `countProfileValues` ignore them, and no editor path writes them. `sanitizeProfile` drops completely
blank records on save.

Saved mappings need no migration: their `profileField` was always a scalar key, which is
still a valid target (the primary education keys now resolve to `education[0]`).

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
 │  resolved adapter:    │                                 │ MapFields
 │  scan, fill           │ ◄── ScanPage, ───┐              │ FillPage
 │                       │     FillFields   │              │
 └──────────┬────────────┘  (approved pairs) │             │ (fields + approvals,
            │ (asks the worker nothing)      │             │  never values)
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
- **Profile exposure.** Every service worker message is accepted only when the sender's URL
  is this extension's origin (Phase 17: including `GetProfileStatus`, which the popup now
  asks for and attaches to the scan). Content scripts share a renderer process with the web
  page, so they get nothing from the worker: they only receive `ScanPage` and, on Fill, a
  `FillFields` message with only the approved field/value pairs, and they accept messages
  only from this extension (`sender.id`). `MapFields` returns `hasValue` flags, not values,
  so the popup never holds profile values either. Fill results coming back from the page
  must have a known status and a short message (`isPlausibleResult`), or they are replaced.
- **Fill checks.** For each approval the service worker re-runs the mapper (with the
  current saved mappings and assignments) on the field and requires the same profile field
  with status _mapped_, _review_, _taught_, or _assigned_, checks the field type can hold
  it, and looks up the value now. Then (Phase 16) it sends `ScanPage` to the tab and
  requires each field to still exist with the same `identity` (key and uniqueness) as the
  approved field (`sameIdentity`); `unsupported: true` from the scan makes every field
  unsupported, no answer makes them failed. Anything else becomes a result (failed,
  unsupported, skipped, not found) and is never sent to the page. `FillInstruction.expected`
  has no identity: fingerprints never go to the page, and `isFillInstruction` rejects one.
- **Handshake at Fill.** `fillApprovedFields` runs the same `GetRuntimeInfo` check before
  `FillPage`; a stale worker fills nothing.
- **Build handshake.** `src/build-info.ts` exposes a build id injected by
  `vite.config.ts` (`__APPLYONCE_BUILD_ID__`) into the popup and service worker, which are
  built together. Analyze starts with `GetRuntimeInfo` (extension pages only; returns only
  the build id). A different id, or `unknown-message` from an older worker, yields the
  `extension-updated` failure ("Reload the extension"); no receiver yields
  `worker-unavailable`. Nothing is scanned or injected in either case.
- **Payload validation.** Every payload is structurally validated in `parseMessage`
  (`messaging/validate.ts`); malformed payloads are rejected. Since Phase 17: a message is
  `{ type }` or `{ type, payload }` only; payloads and nested objects (fields, signals,
  options, records, identities, approvals, handles, instructions) may hold only their own
  keys (`hasOnlyKeys`); text is bounded (`MAX_TEXT_LENGTH`, `MAX_VALUE_LENGTH`); profile
  targets must be canonical (`isProfileTargetText`), assignment targets record-id targets;
  fill values are text, finite numbers, or booleans.
- **Stored data validation (Phase 17).** `migrateProfile` refuses a profile of a known
  version whose shape is corrupted (`findProfileCorruption`: non-object sections, non-plain
  values, huge text, malformed or duplicate record ids since version 4); the repository then
  throws `CorruptedProfileError`, reported as `profile-unavailable`, and the profile page
  shows no editor, so nothing overwrites it. Saved mappings and assignments are validated
  entry by entry on every read (`isStoredSavedMapping`, `isStoredRecordAssignment`); any bad
  entry refuses the whole record (`Corrupted…Error`): mapping continues without them, writes
  are refused, clearing still works.
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

**Adapter selection (Phase 8; resolver since Phase 16).** `FormAdapter.detect` returns a
`PlatformDetection` (`strength`: none / weak / structure / host, plus `evidence` strings).
`resolvePlatform` (`packages/core/adapter.ts`, called through
`content/adapters.ts#resolvePageAdapter`) picks the one site adapter with the strongest
host or structure evidence; weak evidence never selects, a tie is a `conflict` (generic),
and a throwing detector counts as none, so the adapter list order never matters. The
platform-neutral helpers `pageHostname` (lowercase, trailing dot removed, no port),
`isOneOfHosts`, `isSubdomainOf`, `visibleElements` (rendered only), `singleScope`, and
`PlatformScanError` live in `adapters/generic/platform-evidence.ts`; hosts and selectors stay
in each adapter. If `getFields` throws (e.g. `singleScope` found two rendered application
containers), the content script returns `PageScan.unsupported: true` with no fields
(`unreadable-page` in the popup); `fillFields` catches a throwing scan and reports every field
unsupported. Nothing falls back to another adapter after a partial read. The generic scanner accepts
`ScanOptions` (`exclude`, `stableIdentity`, `postProcess`) and `fillFields` accepts a
`scan` function, so a site adapter reuses the whole engine and fills with the same scan it
analyzed with. The Workday adapter (`adapters/workday`) is detection (`detect.ts`), one
selectors file (`selectors.ts`), and a scan (`scan.ts`); see the README. Two platform-
neutral additions support it: `FormField.repeatedCount` (mapped to `repeated-question`,
never filled) and the `search-input` custom pattern (unsupported by the generic engine;
filled only by a site adapter's filler, see Phase 9). Independently,
the custom-dropdown engine never clicks a trigger or option whose whole name is a
navigation or submission action (Next, Continue, Save and Continue, Submit, Apply, Back, …).

**Repeated application sections (Phase 11).** `scanControls` ends with
`markRepeatedSections` (`adapters/generic/repeated-sections.ts`), so generic pages and
Workday share it. For each field it walks up (≤ 12 levels) to the nearest container whose
heading (fieldset legend, aria-labelledby/aria-label, or first-child heading) classifies as
a record type (`classifySectionHeading`, `field-mapper/record-sections.ts`). Containers that
contain another of the same type are wrappers. With ≥ 2 record containers of a type,
fields get `FormField.record = { collection, index }` (document order); inconsistent
numbering sets `repeatedCount` instead (unsupported). A single container changes nothing.
In the mapper, `field.record` short-circuits everything else: `matchRecordField` compares the
field's own question with `RECORD_FIELD_ALIASES[collection]` (exact), the target is
`recordTarget(collection, index, field)` (so education block 1 yields the scalar keys, status
`mapped`, reason `repeated-section`), other targets are `review`; no match → `unsupported`
(`repeated-question`). Record fields have no mapping key (`createMappingKeyParts` → undefined),
so saved mappings never apply to them and Teach is not offered. `FillInstruction.expected`
carries `record`; `fillFields` treats a changed record position as not found. Message
validation accepts `record` only with a known collection and an index below
`MAX_PROFILE_RECORDS`.

**Repeated questions without record context (Phase 12).** After record sections and the site
adapter's `postProcess`, `scanControls` runs `markRepeatedQuestions`
(`adapters/generic/repeated-questions.ts`, formerly Workday-only): visible fields without
`record`, grouped by enclosing form (null = outside any form) and by their Teach key parts
without the field type (question, legend context, identifier), get
`repeatedCount = group size` when a group has two or more fields. `createMappingKeyParts`
returns undefined for them (no key: no Teach, no saved-mapping lookup), and `mapFields`
maps them before anything else to `unsupported` / `repeated-question` with no profile
field and unknown confidence. The service worker's approval re-check therefore refuses
them, and `fillFields` skips a field whose fresh scan shows `repeatedCount > 1`
("now appears more than once"). The popup shows "Repeated question · no record context"
(`mappingLine`) for such fields; unknown questions inside recognized record blocks keep
"No match".

**Greenhouse adapter (Phase 15).** `adapters/greenhouse` is detection (`detect.ts`: an
exact job-board host, or `form#application-form` with a questions section and a
`question_<n>` id or react-select input), one selectors file (`selectors.ts`), a scan
(`scan.ts`: `scanControls` scoped to the application form, with `ScanOptions.exclude` for
voluntary self-identification sections and `postProcess` marking the location lookup as an
unsupported `search-input`), and a filler (`greenhouse-adapter.ts`: `fillFields` with that
scan and a `fillCustom` hook that sends react-select inputs to the generic
`fillCustomSelect`). One platform-neutral addition supports it:
`fillCustomSelect(control, value, timing, { selection })`. `CustomSelectOptions.selection`
reads the selection a widget shows when it keeps it outside the control and outside
`aria-selected` (react-select on Apple devices). With a reader, a non-empty shown selection
is an existing value (skipped), and confirmation requires the reader to show the matched
option. Without one, behavior is unchanged. No mapper, profile, approval, Teach Once, or
fill engine is Greenhouse-specific. Browser suites live in `e2e/` (`e2e/README.md`).

**Field identity and assignment management (Phase 14).** After repeated-question marking,
`scanControls` runs `markFieldIdentity` (`adapters/generic/field-identity.ts`): every field
gets `FormField.identity = { key: "fp-" + FNV hash, unique }` over normalized metadata only
(form id/name/action, fieldset legend, nearest aria-labelled section/group/region, question,
type, name, id unless `isGeneratedId`, autocomplete, the adapter's `stableIdentity` key,
record position). `unique` is false when another field shares the key; position is never a
component. The assignment repository is version 2 (`identityKey` on entries; version 1
entries are read unchanged). `save` requires a unique identity and replaces entries of the
same field (same identity, or a version 1 entry with the same field id). The service worker
matches saved assignments by `identityKey` only for a field whose identity is unique now
(`isSameAssignedField(..., byIdentity)` ignores the element id, which may be generated);
version 1 entries match only attribute-based field ids (`id:`, `name:`, `key:` without `~`) on
uniquely identified fields. Fields without a unique identity get an unsaved assignment:
`SaveAssignment` returns a `transient` reviewed mapping without storing it, the popup sends
`transient: true` with that approval, and the service worker re-validates it at fill.
Since Phase 16 the service worker compares identities against a fresh scan before
sending (see Fill checks); instructions no longer carry `expected.identity`. Extension-only messages `ListAssignments` (labels only: site, path,
question, type, "Education 2 · Degree", available, kind), `RemoveAssignment` (a handle built
from stored data), and `ClearAssignments` back the profile page's Saved assignments section.

**Explicit record assignment (Phase 13).** Record-id targets
(`<collection>@<recordId>.<field>`, `recordIdTarget`) resolve only against the definitions
(`resolveProfileTarget`, record `recordId`) and, for a value, an existing record with that id
in that collection (`getProfileValue`); the editor cannot write through them, saved mappings
never use them (`usableSavedTarget`), and automatic mapping never produces them. Assignments
live in their own repository (`storage/record-assignment-repository.ts`, key
`recordAssignments`, separate from the profile and `savedMappings`): page key (origin +
path), field id, `AssignedField` metadata (type, name, id, label, repeat count; never values),
and the target. The service worker applies them after `mapFields` with
`applyRecordAssignments` (`field-mapper/record-assignments.ts`), and only to fields
`isAssignableField` (repeated, no `record`, mapped `repeated-question`): an existing record →
status `assigned` / source `assigned` (never preselected); a missing record → `unsupported` /
`assignment-unavailable`. `ReviewedMapping.targetLabel` carries "Education 2 → Degree" from
the record's current position. Messages: `MapFields` / `FillPage` carry `page`;
`SaveAssignment`, `DeleteAssignment`, `GetRecordChoices` are extension-only. For an assigned
field the fill instruction carries only `expected.repeatedCount` (never the record);
`fillFields` fills a repeated field only when that count is unchanged.

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
  repository is browser-independent code. It validates the target
  (`resolveProfileTarget`, no arbitrary paths) and field-type compatibility before writing,
  stores the canonical target,
  copies only known key-part fields, upserts by key (keeping `createdAt`), and serializes
  writes. An unknown stored version is refused, not discarded. The service worker is the
  only writer; if mappings can't be read, mapping falls back to automatic only.
- **Separation**: profile and saved mappings are separate records; clearing one never
  touches the other.
- **Access**: `SaveMapping`, `ListMappings`, `DeleteMapping`, `ClearMappings` are accepted
  only from extension pages. Content scripts can send `GetProfileStatus` and nothing else to
  the service worker.
- **Record targets** (Phase 10): `MapFields` also returns `records` (the number of records
  per collection, never values) so the popup can offer Teach targets for existing records
  only. A taught record target whose record is missing reports `hasValue: false`.
- **Filling**: unchanged safety model. `FillPage` re-runs the precedence check with the
  current saved mappings, so only fields currently mapped/review/taught to the approved
  profile field are filled, and only their values are sent to the content script.

**Common fill pipeline hardening (Phase 16).** `fillFields` (`adapters/generic`) is the
only fill pipeline. Per instruction, in order: found again by id with the same type, name,
id, record; same normalized question (`sameQuestion`, `normalizeQuestion`); repeat count;
visible, enabled, writable; for custom controls, never a whole-name navigation action
(`isNavigationAction`) before any hook; then the site hook (`fillCustom`) or the generic
engine. Each outcome goes through `normalizeOutcome` (known `FillStatus`, string message,
never containing the value; otherwise a generic failure), and each fill runs inside
`guardPage` (`page-guard.ts`): capture-phase `submit` listener (preventDefault +
stopImmediatePropagation) and untrusted-click listener for links leaving the document, both
removed when the call ends; a tripped guard turns that field's result into `failed`.
`CustomFiller` hooks receive only `{ field, control }`, the value, and timing. Text fields
accept a page-reformatted phone number only when the digits are identical
(`sameReformattedPhone`).

**Adapter contract tests (Phase 16).** `apps/chrome-extension/src/content/adapter-contract.test.ts`
runs one fixture matrix (the same questions wrapped per platform) through all three
adapters: resolution, metadata (`isFormField`), identity, every control type, existing
values, failure isolation, stale mutations, dynamic questions, and no submission; plus
conflict, look-alike host, and DOM-safety cases for the resolver. `log-failure.test.ts`
checks that no production code logs except through `logFailure`.

**Security hardening (Phase 17).** See `docs/security.md` for the threat model. Code
changes: content scripts refused every worker message; strict payload and stored-data
validation (above); `findMatchingOption` treats a winner that another stage contradicts
(value on one option, visible text on another) as ambiguous; "Save" (and "Save and exit",
"Save draft", "Submit and continue") added to the navigation actions; `fillFields` re-scans
right before each field and requires the control to still be connected (a field whose generated id changed in a framework re-render is found again only through its unique identity, `locate`); `logFailure` logs a
sanitized error name only; the explicit extension-page CSP; Vite's module-preload polyfill
disabled (no `fetch` in the bundle); `readProfilePath` no longer exported. Checks:
`scripts/security-check.mjs` (`pnpm security`), `*/src/security.test.ts` in core, profile,
generic, and the extension, `popup/xss.test.ts`, and `e2e/suites/e2e-phase17.mjs`.

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
