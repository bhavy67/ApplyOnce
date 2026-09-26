# ApplyOnce

A local-first personal autofill system for repetitive forms, starting with job applications.

ApplyOnce keeps one structured personal profile on your device, detects the fields on a form,
maps them to the profile with an explainable confidence score, and lets you review before
filling. It never submits a form for you. The full product specification is in
[`ApplyOnce_Project_Initial_Spec.md`](./ApplyOnce_Project_Initial_Spec.md).

## Status

**Phase 1 — Profile: complete.** You can create, edit, validate, save, and clear a personal
profile in the extension. It is stored locally in the browser. There is no autofill yet.

Next up: **Phase 2 — Generic Chrome autofill** (form detection, field extraction, filling).

## Repository structure

```text
apps/
  chrome-extension/     MV3 extension: popup, profile page (React), IndexedDB storage,
                        service worker, content script
packages/
  core/                 Shared domain types: field types, form fields, profile field keys,
                        mappings, confidence, adapter interface, local storage interface
  profile/              Personal profile model, validation, save-time sanitizing
  field-mapper/         Text normalization, field signatures, matcher interface,
                        basic deterministic alias matcher
adapters/
  generic/              Fallback adapter for ordinary HTML forms (stub)
  workday/              Workday adapter (stub: URL detection only)
  greenhouse/           Greenhouse adapter (stub: URL detection only)
docs/                   Engineering notes (see docs/architecture.md)
```

Dependency rules are described in [`docs/architecture.md`](./docs/architecture.md). In short:
`core` and `profile` depend on nothing; `field-mapper` and adapters depend on `core`; only the
extension uses browser or Chrome APIs.

## Technology

- TypeScript (strict), pnpm workspaces
- React + Vite for the extension, Chrome Manifest V3
- Vitest, ESLint (typescript-eslint), Prettier

TypeScript is pinned to 6.0.x because typescript-eslint does not support TypeScript 7 yet.

## Getting started

Requirements: Node.js 22.13+ (see `.nvmrc`) and pnpm 11 (`corepack enable` picks up the
version from `package.json`).

```sh
pnpm install
```

### Scripts (run from the repository root)

| Command          | What it does                                                       |
| ---------------- | ------------------------------------------------------------------ |
| `pnpm dev`       | Rebuilds the extension into `apps/chrome-extension/dist` on change |
| `pnpm build`     | Production build of the extension                                  |
| `pnpm test`      | Runs all unit tests once (`pnpm test:watch` to watch)              |
| `pnpm lint`      | ESLint across the repository                                       |
| `pnpm format`    | Formats all files with Prettier (`pnpm format:check` to verify)    |
| `pnpm typecheck` | Strict type check of every workspace package                       |
| `pnpm check`     | typecheck + lint + format check + test + build                     |

### Loading the extension in Chrome

1. `pnpm build` (or keep `pnpm dev` running).
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select `apps/chrome-extension/dist`.
4. Click the ApplyOnce toolbar icon. After a rebuild, press the reload icon on the extension
   card.

## The profile

### Using the profile editor

1. Click the ApplyOnce toolbar icon, then **Manage Profile**. (The profile page is also the
   extension's options page: right-click the icon → **Options**.)
2. Fill in whatever you want to reuse. Every field is optional.
3. Press **Save profile** (or Enter). Invalid values are highlighted and nothing is saved
   until they are fixed; otherwise "Profile saved" appears.
4. **Clear profile…** asks for confirmation, then deletes the saved profile.

Edits are held in memory until you save. Leaving the page with unsaved changes asks for
confirmation.

### Model and validation

The model lives in `packages/profile` (`Profile`): identity, contact, location, education
(list), experience (with a `workHistory` list), links, preferences, authorization, documents,
and custom answers. The editor covers the first eight; documents, custom answers, and work
history are in the model but have no UI yet, and are preserved when saving.

- **Validation** (`validateProfile`) checks the format of values that are present: email,
  phone, URLs, years of experience (0–70), graduation year (1950 to 10 years ahead). Blank
  fields are always valid, so a partial profile can be saved.
- **Completeness** (whether a profile has enough data for a given form) is a separate concern
  and never blocks saving. It is not implemented yet.
- **Sanitizing** (`sanitizeProfile`) runs on save: it trims text, removes blank values, and
  drops empty education entries.

### Where the data is stored

In IndexedDB, in the extension's own origin (database `applyonce`, object store `records`,
key `profile`). Data stays in this Chrome profile on this device and is deleted if the
extension is uninstalled. Nothing is sent anywhere; there is no backend.

Storage code lives only in the extension (`apps/chrome-extension/src/storage`), behind the
`LocalStore` interface from `packages/core`. Two version numbers exist:

- `Profile.schemaVersion` (currently 1): the shape of the profile. Loading a profile with an
  unknown version fails loudly instead of discarding it; migrations will go in
  `profile-repository.ts` when the version is bumped.
- The IndexedDB database version: the object-store layout.

To inspect stored data during development, open the profile page, then DevTools →
Application → IndexedDB → `applyonce`.

## How the packages are built

Workspace packages are internal and export their TypeScript source directly
(`"exports": { ".": "./src/index.ts" }`). They have no separate build step: they are
type-checked individually and bundled by Vite into the extension. Tests import them the same
way.

The extension uses two Vite configs: `vite.config.ts` builds the popup, the profile page, and
the service worker (ES modules), and `vite.content.config.ts` builds the content script as a single classic script,
because MV3 content scripts cannot be ES modules.

## Privacy and security conventions

- Everything stays local. No backend, analytics, telemetry, or external requests.
- Never log profile values. ESLint rejects `console.log`/`console.info`/`console.debug`;
  `console.warn`/`console.error` are allowed for failures and must not include profile data.
- The extension requests no permissions yet. Page access will be requested narrowly
  (`activeTab` + `scripting`, on user action) when form detection is implemented.
- No secrets or API keys in the repository. `.env*` files are git-ignored.

## Intentionally not implemented yet

- Form field extraction and filling (generic, Workday, Greenhouse adapters are stubs)
- Resolving a profile field key to a profile value, and giving content scripts access to the
  profile (they cannot read the extension's IndexedDB directly)
- Profile completeness checks
- Editing work history, documents, and custom answers in the UI
- Encryption at rest of the local profile
- Confidence review UI, manual mapping, "Teach Once" saved mappings
- Android app (`android/` will be added in Phase 7)
- Encrypted sync, backend, accounts
- AI-based field mapping
- CI (GitHub Actions), Playwright and DOM fixture tests, React component tests
