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
- IndexedDB belongs to the extension origin. Content scripts run in the page origin and must
  get profile data through extension messaging (Phase 2), never by storing it in the page.
- Tests run the real IndexedDB store against `fake-indexeddb` (dev dependency), each test
  with an isolated `IDBFactory`.

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
