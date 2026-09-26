# Architecture notes

## Package dependencies

```text
apps/chrome-extension ──► adapters/* ──► packages/core
          │                                   ▲
          └──► packages/field-mapper ─────────┘
          └──► packages/profile (from Phase 1)
```

- `packages/core` and `packages/profile` have no internal dependencies.
- `packages/*` compile with `lib: ["ES2022"]` and no DOM or Node types, so using a browser
  API there is a type error. Keep them platform-independent.
- `adapters/*` may use DOM types. Each adapter depends only on `core`, never on another
  adapter, so Workday and Greenhouse logic can evolve independently.
- Only `apps/chrome-extension` may use `chrome.*` APIs.

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
