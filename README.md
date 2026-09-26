# ApplyOnce

A local-first personal autofill system for repetitive forms, starting with job applications.

ApplyOnce keeps one structured personal profile on your device, detects the fields on a form,
maps them to the profile with an explainable confidence score, and lets you review before
filling. It never submits a form for you. The full product specification is in
[`ApplyOnce_Project_Initial_Spec.md`](./ApplyOnce_Project_Initial_Spec.md).

## Status

**Phase 3 — Deterministic field mapping and safe autofill: complete.**

- Phase 1: you can create, edit, validate, save, and clear a personal profile, stored
  locally in the browser.
- Phase 2: **Analyze this page** scans the current tab once and lists its form fields.
- Phase 3: each detected field is mapped to a profile field with an explainable
  confidence. You review the mappings, and **Fill** writes only the fields you approved.
  Nothing is ever submitted.

Generic HTML forms only; Workday and Greenhouse get dedicated support in later phases.

## Repository structure

```text
apps/
  chrome-extension/     MV3 extension: popup (analyze, review, fill), profile page
                        (React), IndexedDB storage, service worker (profile access,
                        mapping), content script (scan, fill), typed message protocol
packages/
  core/                 Shared domain types: field types, form fields, profile field keys,
                        mappings, confidence, adapter interface, local storage interface
  profile/              Personal profile model, validation, save-time sanitizing,
                        profile field → value lookup
  field-mapper/         Text normalization, field signatures, deterministic alias
                        matcher with confidence, per-field mapping status
adapters/
  generic/              Field scanner and filler for ordinary HTML forms (used on
                        every page)
  workday/              Workday adapter (stub: URL detection only)
  greenhouse/           Greenhouse adapter (stub: URL detection only)
docs/                   Engineering notes (see docs/architecture.md)
```

Dependency rules are described in [`docs/architecture.md`](./docs/architecture.md). In short:
`core` depends on nothing; `profile`, `field-mapper`, and adapters build on it; only adapters
use DOM APIs and only the extension uses Chrome APIs.

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
2. Click **Analyze this page**. The popup lists every detected field with the profile field
   it maps to, the confidence, and whether it will be filled. Analysis never changes the
   page.
3. Review the list. High-confidence matches with a profile value start selected; tick
   review-level matches you agree with, untick anything you don't want filled.
4. Click **Fill N selected fields**. Each field then shows Filled, Skipped, Failed, or Not
   found, and a summary line such as "8 fields filled · 1 failed · 1 need review".
5. Check the page and submit it yourself. ApplyOnce never submits.

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
  │
  ├─ MapFields { fields } ─► service worker: deterministic mapper + profile
  │                         ◄─ one mapping per field + hasValue  (no values)
  │
  │  … user reviews and clicks Fill …
  │
  └─ FillPage { tabId, approvals } ─► service worker
                  re-checks each approval, looks up only those values
                  ├─ FillFields { approved field/value pairs } ─► content script
                  │     re-finds each field in the current DOM, fills, notifies the page
                  ◄─ one result per field (filled / skipped / failed / not-found / unsupported)
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

### Mapping and confidence

Mapping is deterministic and explainable. Every point of a score comes from a named signal:

| Signal                                                                            | Weight |
| --------------------------------------------------------------------------------- | ------ |
| HTML `autocomplete` token (e.g. `given-name`)                                     | 80     |
| Label or `aria-label` equals a known phrase                                       | 80     |
| `name`/`id` equals a known phrase (also the last part of `applicant[first_name]`) | 40     |
| Placeholder equals a known phrase                                                 | 40     |
| A multi-word phrase appears inside a longer label                                 | 40     |
| Nearby text or fieldset legend equals a known phrase                              | 30     |
| Field type suits the profile field (only adds to a text match)                    | 10     |

Scores are capped at 100. **High** (≥ 90) → status _mapped_, pre-selected. **Medium** (70–89)
and **Low** (40–69) → status _review_, selectable but never pre-selected. Below 40 → _unknown_,
never filled. If a second profile field also scores ≥ 50, the result is capped at Medium
(a _conflict_). A match the field cannot hold (e.g. an email into a checkbox) or a hidden or
disabled field is _unsupported_. The weights are provisional, to be tuned on real forms.

### Filling

- Text-like fields: the value is written with the element's native setter, then `input` and
  `change` events are dispatched, so React, Vue, Angular and plain listeners see the change.
  Fields that already have a value are **skipped**, never overwritten.
- Select: matched by exact option value, then normalized value, then normalized label. No
  match or several matches means **failed**, and the selection is left alone.
- Checkbox: set from yes/no values with a real `click()`. Radio group: the one option that
  matches is clicked (booleans match Yes/No options).
- Before filling, the page is scanned again and each field is located by its deterministic
  id and checked against its metadata from analysis. A removed or replaced field is
  **not found**; the others are still filled.
- Filling never submits, clicks buttons, or touches fields that were not approved.

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
  content scripts, which share a process with the web page, get a profile status and, after
  you click Fill, only the approved field/value pairs. The popup never receives profile
  values (only whether a value exists). Mapping and fill requests are refused from content
  scripts. Nothing else is written into the page's DOM, globals, storage, or URL.
- The scanner collects field metadata only, never page values.
- No secrets or API keys in the repository. `.env*` files are git-ignored.

## Intentionally not implemented yet

- Workday and Greenhouse extraction and filling (the adapters only recognise their URLs;
  the generic adapter is used everywhere)
- Education, work history, work mode, and employment type as fill targets (no profile field
  keys yet)
- Teach Once / saved mappings, manual re-mapping of a field to another profile field
- Continuous DOM observation (MutationObserver), iframes, shadow DOM, custom widgets,
  date pickers, file uploads
- Profile completeness checks
- Editing work history, documents, and custom answers in the UI
- Encryption at rest of the local profile
- Android app (`android/` will be added in Phase 7)
- Encrypted sync, backend, accounts
- AI-based field mapping
- CI (GitHub Actions), Playwright and DOM fixture tests, React component tests
