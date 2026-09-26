# ApplyOnce

A local-first personal autofill system for repetitive forms, starting with job applications.

ApplyOnce keeps one structured personal profile on your device, detects the fields on a form,
maps them to the profile with an explainable confidence score, and lets you review before
filling. It never submits a form for you. The full product specification is in
[`ApplyOnce_Project_Initial_Spec.md`](./ApplyOnce_Project_Initial_Spec.md).

## Status

**Phase 2 — Form detection and extension messaging: complete.**

- Phase 1: you can create, edit, validate, save, and clear a personal profile, stored
  locally in the browser.
- Phase 2: **Analyze this page** in the popup scans the current tab once and lists the form
  fields it found, and the content script confirms through the service worker that a
  profile is available.

Nothing is mapped or filled yet. Next up: mapping detected fields to the profile and
filling them after review.

## Repository structure

```text
apps/
  chrome-extension/     MV3 extension: popup (page analysis), profile page (React),
                        IndexedDB storage, service worker (profile access), content
                        script (page scan), typed message protocol
packages/
  core/                 Shared domain types: field types, form fields, profile field keys,
                        mappings, confidence, adapter interface, local storage interface
  profile/              Personal profile model, validation, save-time sanitizing
  field-mapper/         Text normalization, field signatures, matcher interface,
                        basic deterministic alias matcher
adapters/
  generic/              Field scanner for ordinary HTML forms (used on every page)
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

## Analyzing a page

1. Open a page with a form and click the ApplyOnce toolbar icon.
2. Click **Analyze this page**. The popup shows how many fields were detected, how many have
   a clear label and how many need review, how many are hidden or disabled, and whether a
   profile is saved.
3. **View fields** lists every detected field: its label (or "Unlabeled field"), type,
   `name`/`id`, and flags (required, hidden, disabled, needs review).

Nothing on the page is changed or filled.

### What happens

```text
popup ── chrome.tabs.query (active tab) ── URL check (http/https/file only)
  │
  ├─ Ping ─► content script?  no answer → chrome.scripting.executeScript(content.js)
  ├─ ScanPage ─► content script
  │               ├─ generic adapter scans the DOM once → FormField[]
  │               └─ GetProfileStatus ─► service worker ─► ProfileRepository ─► IndexedDB
  │                                     ◄─ { hasData, valueCount }  (no values)
  ◄─ { title, platform, fields, profileStatus }
```

- **Permissions:** `activeTab` and `scripting` only. There are no host permissions and no
  content script registered in the manifest. `activeTab` grants temporary access to the
  current tab only when you click the toolbar icon, so ApplyOnce cannot read any page you
  have not explicitly opened it on.
- **Supported fields:** text (including `search` and `url` inputs), email, tel, number,
  textarea, select, checkbox, radio (grouped by name). Ignored: password, hidden, file,
  date/time pickers, buttons, rich text editors, and custom widgets.
- **What is inspected:** for each supported control, its type, `name`, `id`, label text
  (`<label for>`, wrapping `<label>`, `aria-labelledby`), `aria-label`, `placeholder`,
  `autocomplete`, fieldset legend or nearby text for unlabeled fields, required/disabled/
  visible state, select and radio option labels, and the enclosing form's `id`/`name`/
  `action`. Also the page title.
- **What is never read:** values typed into or selected on the page, passwords, hidden
  inputs, and other page content.
- **Pages that cannot be analyzed:** `chrome://` and other browser pages, extension pages,
  the Chrome Web Store, and `file://` pages unless "Allow access to file URLs" is enabled
  for the extension. These show "This page cannot be analyzed." Only the top frame is
  scanned (not iframes).

Unlabeled or ambiguous fields are counted as **needs review**. Hidden and disabled fields are
listed but not counted as detected.

## How the packages are built

Workspace packages are internal and export their TypeScript source directly
(`"exports": { ".": "./src/index.ts" }`). They have no separate build step: they are
type-checked individually and bundled by Vite into the extension. Tests import them the same
way.

The extension uses two Vite configs: `vite.config.ts` builds the popup, the profile page, and
the service worker (ES modules), and `vite.content.config.ts` builds the content script as a
single classic script, because MV3 content scripts cannot be ES modules.

## Privacy and security conventions

- Everything stays local. No backend, analytics, telemetry, or external requests.
- Never log profile values. ESLint rejects `console.log`/`console.info`/`console.debug`;
  `console.warn`/`console.error` are allowed for failures and must not include profile data.
- Minimal permissions: `activeTab` + `scripting`, with injection only after an explicit
  click. No host permissions.
- The profile stays inside the extension. The service worker is the only context that reads
  it for others. The full profile (`GetProfile`) is returned only to extension pages;
  content scripts, which share a process with the web page, only get a profile status with
  no values. Nothing is written into the page's DOM, globals, storage, or URL.
- The scanner collects field metadata only, never page values.
- No secrets or API keys in the repository. `.env*` files are git-ignored.

## Intentionally not implemented yet

- Mapping detected fields to the profile, and filling. No field is ever filled yet.
- Workday and Greenhouse field extraction (the adapters only recognise their URLs; generic
  extraction is used everywhere)
- Resolving a profile field key to a profile value, and deciding how the needed values
  reach the page for filling
- Continuous DOM observation (MutationObserver), iframes, shadow DOM, custom widgets
- Profile completeness checks
- Editing work history, documents, and custom answers in the UI
- Encryption at rest of the local profile
- Confidence review UI, manual mapping, "Teach Once" saved mappings
- Android app (`android/` will be added in Phase 7)
- Encrypted sync, backend, accounts
- AI-based field mapping
- CI (GitHub Actions), Playwright and DOM fixture tests, React component tests
