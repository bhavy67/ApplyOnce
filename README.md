# ApplyOnce

A local-first personal autofill system for repetitive forms, starting with job applications.

ApplyOnce keeps one structured personal profile on your device, detects the fields on a form,
maps them to the profile with an explainable confidence score, and lets you review before
filling. It never submits a form for you. The full product specification is in
[`ApplyOnce_Project_Initial_Spec.md`](./ApplyOnce_Project_Initial_Spec.md).

## Status

**Phase 16 — Cross-ATS hardening + adapter reliability: complete.**

- Phase 1: you can create, edit, validate, save, and clear a personal profile, stored
  locally in the browser.
- Phase 2: **Analyze this page** scans the current tab once and lists its form fields.
- Phase 3: each detected field is mapped to a profile field with an explainable
  confidence. You review the mappings, and **Fill** writes only the fields you approved.
- Phase 4: you can **Teach** ApplyOnce which profile field an unknown field is, or
  **Change** any mapping. Taught mappings are saved locally and reused on later pages,
  and you can delete them. Teaching never fills anything.
- Phase 5: the profile covers the fields job applications commonly ask for (current job,
  work mode, employment type, education, website), all mapped, filled, and teachable
  through one set of canonical field definitions. Older profiles are migrated safely.
- Phase 6: more reliable on real-world generic forms: wrapper labels, required markers,
  checkbox groups, read-only fields, stricter existing-value protection, and verified with
  plain HTML, React, Vue, and Angular forms. A stale background service is detected.
- Phase 7: custom dropdowns that follow common ARIA combobox/listbox patterns are detected,
  mapped like native selects, and filled by opening them and choosing the one matching
  option, with the selection confirmed before reporting success.
- Phase 8: Workday pages are detected and scanned with Workday-specific rules (scope,
  stable field identity, hidden helpers, search inputs, repeated records), then mapped,
  reviewed, and filled by the same generic engine. See [Workday](#workday).
- Phase 9: Workday search-as-you-type fields (e.g. "School or University") are filled by
  typing the approved value once and choosing the one suggestion that matches it exactly,
  confirmed before success. See [Search fields](#search-fields-workday-autocomplete).
- Phase 10: the profile holds several education entries, work experience entries, and
  certifications, edited on the profile page and targetable with Teach Once. See
  [Repeatable records](#repeatable-records).
- Phase 11: repeated application sections ("Education 1/2/3", "Work Experience 1/2",
  "Certification 1/2") are recognised, and each block's fields map to the profile record at
  the same position. See [Repeated application sections](#repeated-application-sections).
- Phase 12: a question asked more than once without record context (e.g. two "Degree"
  fields under one "Education" heading) is never filled, on generic pages as on Workday. See
  [Repeated questions](#repeated-questions-without-record-context).
- Phase 13: every profile record has a stable id, and you can explicitly **assign** a
  repeated field to one specific record ("this Degree is Education 1's"). See
  [Record assignment](#explicit-record-assignment).
- Phase 14: assignments follow the field itself (not its position) whenever the page lets
  ApplyOnce tell identical questions apart, and the profile page lists saved assignments so
  you can remove them. See [Field identity](#field-identity).
- Phase 15: a Greenhouse adapter for public Greenhouse job-board application forms. It uses
  the same mapper, profile, Teach Once, record assignment, and fill engine, and never fills
  voluntary self-identification (EEO) questions. See [Greenhouse](#greenhouse).
- Phase 16: the three adapters (generic, Workday, Greenhouse) are held to one contract: a
  deterministic platform resolver with fixed precedence, safe host and DOM evidence, a clear
  "cannot read this page" result instead of a silent fallback, a fresh check of every
  approval against the page and the profile right before filling, and a guard that stops any
  submission or navigation while filling. See [Platforms and adapters](#platforms-and-adapters).

Nothing is ever submitted.

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
  workday/              Workday adapter: detection and Workday-specific scanning on top of
                        the generic adapter (current application step only)
  greenhouse/           Greenhouse adapter: detection and Greenhouse-specific scanning and
                        react-select reading on top of the generic adapter
docs/                   Engineering notes (see docs/architecture.md)
e2e/                    Browser suites per phase and their fixture apps (see e2e/README.md)
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

Browser suites (real Chrome, fake data, local fixtures) are in `e2e/`; see
[`e2e/README.md`](./e2e/README.md).

### Loading the extension in Chrome

1. `pnpm build` (or keep `pnpm dev` running).
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select `apps/chrome-extension/dist`.
4. Click the ApplyOnce toolbar icon.

After every rebuild, press the reload icon on the extension card. When files change on
disk, Chrome can keep running the **previous** service worker code, even across a browser
restart, until the extension is reloaded, so the popup and the service worker would run
different builds. Since Phase 6 the popup detects this before doing anything: each build
has a build id (`<version>+<build time>`) compiled into both, and Analyze first asks the
service worker for its id. If it differs, or the worker is too old to answer, the popup
shows **"ApplyOnce was updated. Reload the extension (chrome://extensions → reload) and try
again."** and touches nothing. An unresponsive worker gets its own "not responding"
message. ApplyOnce never restarts itself.

## The profile

### Using the profile editor

1. Click the ApplyOnce toolbar icon, then **Manage Profile**. (The profile page is also the
   extension's options page: right-click the icon → **Options**.)
2. Fill in whatever you want to reuse. Every field is optional. Education, Work
   experience, and Certifications are lists: **+ Add …** adds an entry, and each entry has
   ↑ / ↓ (reorder) and **Remove**.
3. Press **Save profile** (or Enter). Invalid values are highlighted and nothing is saved
   until they are fixed; otherwise "Profile saved" appears.
4. **Clear profile…** asks for confirmation, then deletes the saved profile.

Edits are held in memory until you save. Leaving the page with unsaved changes asks for
confirmation.

### Model and fields

The model lives in `packages/profile` (`Profile`, schema version 3). Every mappable field is
defined once, in `packages/core/profile-field.ts`: scalar fields in `PROFILE_FIELDS` (canonical
key, path, label, editor section, value kind, supported form field types, choices) and
record fields in `PROFILE_RECORD_FIELDS` (below). Those definitions drive the profile editor,
validation, value lookup, the mapper, the Teach selector, and saved-mapping validation.

| Section              | Fields (canonical key → path)                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| Personal information | `first_name`, `middle_name`, `last_name`, `full_name` → `identity.*`; `email`, `phone` → `contact.*` |
| Location             | `address`, `city`, `state`, `country`, `postal_code` → `location.*`                                  |
| Professional         | `linkedin_url`, `github_url`, `portfolio_url`, `website_url` → `links.*`                             |
| Employment           | `current_title`, `current_company`, `experience_years`, `notice_period` → `experience.*`             |
| Job preferences      | `work_mode`, `employment_type`, `willing_to_relocate` → `preferences.*`                              |
| Education            | `highest_degree`, `field_of_study`, `institution`, `graduation_year` → `education[0].*` (primary)    |
| Authorization        | `work_authorization`, `requires_sponsorship` → `authorization.*`                                     |

- **Value types:** every value is a single string, number, or boolean. Work mode is one of
  remote / hybrid / onsite; employment type is one of full-time / part-time / contract /
  internship / temporary.
- **Repeatable records** are described in [Repeatable records](#repeatable-records).
  Documents and custom answers remain in the model without UI and are preserved when saving.
- **Validation** (`validateProfile`) checks each value by its kind: email, phone, URL, years
  of experience (0–70), years (1950 to 10 years ahead), months (`YYYY-MM`), yes/no, and
  choices, for scalar fields and for every field of every record. Blank
  fields are always valid, so a partial profile can be saved. Completeness is separate and
  not implemented.
- **Normalization:** choice values ignore case, spacing, hyphens, and underscores ("REMOTE",
  "On-site", "full_time", "Full Time" all work) and are stored canonically on save. No
  synonyms beyond that. **Sanitizing** on save also trims text and removes blank values.

### Repeatable records

| Collection (`Profile.*`) | Record fields                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `education`              | institution, degree, fieldOfStudy, startYear, graduationYear                                 |
| `workExperience`         | company, title, location, startDate, endDate (`YYYY-MM` text), current (yes/no), description |
| `certifications`         | name, issuer, issueYear, credentialUrl                                                       |

Each record field definition names its collection, record property, label, value kind,
supported form field types, and whether Teach Once may target it.

- **Primary education (one source of truth).** `education[0]` is the primary (highest)
  record. The long-standing keys `institution`, `field_of_study`, `highest_degree`, and
  `graduation_year` are not separate values: their definitions are derived from the
  education record fields, and they read and write `education[0]`. The editor shows
  "Education 1 (primary)" with those labels, even before it has a value. Reordering or
  removing records changes which record is primary.
- **Current employment stays separate.** `current_title`, `current_company`, and
  `experience_years` remain single values under `experience`. Work experience entries are
  an independent list: nothing is copied or synchronized between them, and no entry is
  created from the current-employment fields.
- **Blank and partial records.** Adding an entry creates an editable blank record; removing
  it deletes it. On save, records left completely blank are dropped; partially filled
  records are kept. Every value is optional; populated values are validated by kind, and a
  current role (`current`) may not also have an end date. Dates are kept as `YYYY-MM` text
  and never parsed further.
- **Limit.** At most 20 entries per collection (`MAX_PROFILE_RECORDS`): generous for a real
  history, and a bound on storage and on the Teach selector. **+ Add** is disabled at the
  limit; there is no pagination.
- **Value lookup.** `getProfileValue` accepts a scalar key (`institution`) or a record
  reference (`education[1].institution`, `workExperience[0].company`,
  `certifications[0].name`). Record references must match
  `<collection>[<index>].<field>` exactly, with a defined field and an index below the
  limit; anything else (other paths, `__proto__`, out-of-range or missing records) returns
  no value. `education[0].<field>` is the same target as its scalar key.
- **Mapping.** Automatic mapping only ever targets scalar keys, so it fills the primary
  education record and current employment. It never decides which historical record
  matches a page field: previous schools, employers, and certifications are filled only
  through a Teach Once mapping to a specific record.
- **Teach Once targets.** The selector groups targets as in the editor: scalar sections, then
  "Education 1 (primary)", "Education 2", "Work experience 1", "Certification 1", … for the
  records the profile has (the popup receives record counts only, never values). Options read
  "Education 2 → Institution". A taught mapping stores the target (e.g.
  `education[1].institution`); mappings saved before Phase 10 store scalar keys, which still
  resolve unchanged. Targets are positions: after reordering, "Education 2" means whatever is
  second, and a mapping to a record that no longer exists shows "No value in your profile".
  As before, teaching never fills, taught fields start unticked, and deleting a mapping never
  changes the profile.
- **Privacy.** Records stay in the extension's IndexedDB. Only the approved value for each
  approved field reaches the content script; no record lists, counts, or other values do.
- **Repeated application sections** are filled from these records by position (Phase 11,
  below).

### Repeated application sections

A form that repeats a block per record (several education, work-experience, or
certification blocks) is recognised when Analyze scans it, on generic pages and Workday:

- **Detection.** A field's section is its nearest ancestor with a heading: a fieldset
  legend, an `aria-labelledby` / `aria-label`, or a heading element as its first child.
  The heading must name a record type exactly, optionally with a number ("Education 2",
  "Work Experience", "Licenses & Certifications", …). Only a type with **two or more** such
  blocks is a repeated section; a section containing the blocks is a wrapper. Field order or
  repeated labels alone are never used.
- **Record position.** Blocks are numbered in document order. Numbered headings must read
  exactly 1, 2, 3, … in that order; otherwise (out of order, gaps, duplicates, mixed) the
  whole structure is ambiguous and its fields are unsupported ("This question repeats on the
  page"), never filled.
- **Field → target.** Inside block _n_, a field's own question (label, else aria-label,
  else placeholder) must exactly equal a known question for that record type, e.g.
  "Institution" / "School or University" → `education[n-1].institution`, "Job Title" →
  `workExperience[n-1].title`, "Credential URL" → `certifications[n-1].credentialUrl`.
  An unknown question in a block (e.g. "GPA") is unsupported. These are the Phase 10
  targets; nothing new is stored.
- **Approval.** Education block 1 is the primary record: its fields use the usual keys
  (`institution`, …) and are selected as before. Every other block field (Education 2+, all
  work-experience and certification blocks) is shown for review, and filled only after you
  tick it. Work-experience blocks never map to the current-employment fields.
- **Missing and partial data.** A block without a matching profile record, or a record field
  left blank, shows "No value in your profile" and is never filled. Extra profile records are
  ignored. Positions follow the current profile order.
- **Teach Once** is not offered inside repeated sections (the block's position decides the
  record), and saved mappings are not applied there: a mapping taught for "Institution"
  elsewhere cannot fill every block with the same value.
- **Safety.** Each fill instruction carries its record position; if the page changed so the
  field is now in another block (or no longer in a repeated section), it is not filled.
- **Dynamic forms.** ApplyOnce never clicks "Add Education", "Add Another", or similar. If you
  add a block, click **Analyze again**: sections are found on each scan (there is no
  continuous page observation).
- **Unsupported:** a single block (it maps as before), blocks without a record heading
  (their repeated questions are never filled, see below), headings with other wording, date
  pickers / `type="month"` inputs, and choosing records by content.

### Repeated questions without record context

**ApplyOnce does not automatically assign repeated identical fields to different profile
records unless a recognized record context exists.** A recognized repeated section
("Education 1", "Education 2", …, above) is record context; page position alone is not: the
second "Degree" on a page may be a second degree, a duplicate, or something else entirely, and
guessing would put one record's value (usually the primary one) into several fields.

- **What counts as repeated.** Visible fields in the same form (fields outside any form share
  one scope) whose question is the same after the usual normalization: label, else
  aria-label, placeholder, or nearby text, ignoring case, spacing, punctuation, and
  required/optional markers ("Degree *" = "Degree (required)"). A fieldset legend is part
  of the question, so "Phone" under "Home" and under "Work" differ; plain headings are not.
  Fields without a question compare by name/id. Different questions that share a word
  ("Education level" / "Education preferences", "Current Company" / "Previous Company") are
  not repeated. The control type does not matter: a question asked twice is ambiguous
  whether it is a text box or a dropdown. The same question in two separate forms is two
  independent questions. Hidden copies are not counted.
- **What happens.** Each copy is shown as "Repeated question · no record context" and "Asked
  more than once, and ApplyOnce can't tell which profile record each one is for. Will not be
  filled." It has no profile target, is never selected, cannot be selected or taught, and
  saved mappings for the same question are not applied to it (they keep working wherever the
  question appears once). Other fields fill normally.
- **At fill time** the page is scanned again: a field that has become repeated since Analyze
  is skipped ("This question now appears more than once on the page. Analyze again."); one
  that stopped being repeated is filled only after a new Analyze and approval.
- **Generic pages and Workday** use the same rule (in the generic scanner).
- **Assign record** is the only way to make such a field fillable (see below).

### Explicit record assignment

**ApplyOnce never automatically assigns an ambiguous repeated field to a profile record.
Record assignment is explicit user action.**

- **Where.** Only fields shown as "Repeated question · no record context" offer **Assign
  record** (single fields keep automatic mapping and Teach Once; fields in recognized record
  sections keep their positional mapping).
- **How.** The picker lists your records in their current order, e.g. "Education 1 —
  University A · Master's", with the fields this control can hold ("Education 1 → Degree").
  Labels use only a record's summary fields (institution and degree, company and title,
  certification name and issuer), never contact details. Record ids are never shown.
- **After assigning** the field reads "Education 1 → Degree · Assigned by you" and stays
  unticked: assigning never fills. Tick it and **Fill** to send that record's value. **Change
  record** replaces the assignment (the field is unticked again); **Remove assignment** makes
  it a repeated question again.
- **Stable identity.** An assignment points to the record's id, not its position: reorder
  your records and it still fills from the same record (now shown as, say, "Education 2 →
  Degree"); edit the record and its new value is used.
- **Deleted records.** If the assigned record is deleted, the field shows "Assigned record no
  longer exists", cannot be selected, and is never filled from another record. A new record
  gets a new id and never inherits an old assignment.
- **Scope (page-scoped, not question-level).** An assignment is stored locally for this page
  (origin + path) and this field, identified by its field identity (below) and metadata,
  including how many times its question appears. If the field or the repetition changes
  (for example another copy of the question appears, or the field is renamed), the
  assignment no longer applies and the field must be assigned again. It never applies to
  other pages or to other fields asking the same question, and saved Teach Once mappings still
  never apply to repeated fields.
- **Teach Once vs. Assign record.** Teach Once maps a question to a profile field wherever
  it appears once. Assign record maps one repeated field instance on one page to one specific
  record. They are stored separately.
- **At fill time** the service worker re-checks the assignment (same field, record still
  there, compatible type, value present) and the page re-checks that the field and its
  repetition are unchanged. Anything that fails is skipped; other fields still fill.
- **Privacy.** Record ids, record lists, field identities, and assignments stay inside the
  extension; the page receives only the approved value for each approved field.

### Field identity

**ApplyOnce never uses page position alone as stable identity.** Each scanned field gets a
fingerprint of its semantic metadata, strongest signals first:

1. a platform key the site adapter owns (e.g. a Workday automation id);
2. the element's own id, unless it looks framework-generated (React `:r1:` / `«r1»` /
   `_r_1_`, `v-12`, `mat-input-7`, `mui-3`, UUIDs, long hex, …), since those change on
   re-render;
3. the `name` attribute and the autocomplete token;
4. the context: form id/name/action, fieldset legend, and the nearest explicitly labeled
   container (a section/group/region with `aria-label` or `aria-labelledby`);
5. the question (label, aria-label, or placeholder) and the control type.

Never used: position or index, classes, current values, profile values, or other page text.
The fingerprint is never shown, logged, or written to the page.

- **Stable identity.** When no other field on the page has the same fingerprint, a saved
  assignment is matched by it: it follows the field when the page reorders fields, and
  through React, Vue, or Angular re-renders that recreate nodes and change generated ids.
- **No stable identity.** When two fields are truly identical (same question, no
  distinguishing name, id, or context), neither has a stable identity. You can still assign
  them, with a warning, but the assignment is **not saved**: it applies only until you close
  the popup. **When a page provides no stable way to distinguish identical fields,
  assignments may remain page-scoped and require reassignment after structural changes.**
  (Within one popup session, ApplyOnce cannot notice two truly identical fields being swapped.)
- **Duplicate identity.** If two fields on the page match a saved assignment's identity, it
  applies to neither.
- **Changed field.** A field whose identity changed (e.g. a new `name`) does not inherit the
  old assignment; the page also refuses a fill if the field's identity changed since Analyze.
- **Earlier assignments.** Assignments saved by version 0.14 (no identity) are kept and still
  apply when the field's id comes from its own `id`/`name` attribute and the field is
  uniquely identifiable; otherwise they stay listed (marked "saved by an earlier version")
  until you remove them or assign the field again.

### Managing saved assignments

The profile page has three separate parts: the profile, **Saved field mappings** (Teach
Once), and **Saved assignments** (with a count). Each assignment shows the site and path,
the question, the control type, and the record and field ("→ Education 2 · Degree", from the
record's current position); never record contents, ids, or page values. An assignment whose
record was deleted shows **Unavailable (record deleted)** and is never retargeted. **Remove**
deletes one; **Clear all assignments…** (with confirmation) deletes them all. Neither
changes the profile, saved field mappings, or any page. **Clear profile** does not delete
assignments: they stay listed as unavailable until removed.

### Migration

Profiles are migrated when loaded (`migrateProfile`, pure, deterministic, idempotent, and
non-destructive; the stored data is never modified in place).

Version 3 (Phases 10–12) → 4: every record gets a stable `id`. New records get a random
UUID. Records stored before version 4 get an id derived once from their stored content and
position, so every load (profile page, service worker) agrees on it until the profile is saved
with it; after that it is read from storage and never recomputed. Values are unchanged, and
loading still never writes.

Version 2 (Phases 5–9) → 3:

- the primary education record becomes `education[0]` (a blank one creates no record);
- education entries kept under `legacy` since version 1 become `education[1…]` in their
  original order (without a primary record they stay in `legacy`, so a historical entry is
  never promoted to primary);
- `experience.workHistory` entries (stored but never editable before) move unchanged to
  `workExperience`; current company, title, and years stay where they were; no work
  experience entry is created and no dates are invented;
- `certifications` starts empty.

Version 1 (Phases 1–4) is first brought to version 2:

- the first education entry becomes the primary education record;
- the first selected work mode and employment type become the single values;
- any **additional** entries are kept under `legacy` (and, for education, become records in
  the step to version 3). Additional work modes and employment types stay in `legacy`, shown
  read-only at the bottom of the profile page as "Kept from an earlier version", and never
  used for filling. Nothing is dropped.

New fields start empty. Loading never writes: the migrated profile is stored (as version 3)
the next time you save. Unknown or newer versions are refused, never overwritten. Saved
field mappings are a separate record and are untouched; every existing profile field key
still exists, so they keep working. A mapping to a key that no longer exists is ignored
(automatic mapping applies) and shown as "Unknown profile field" so it can be deleted.

### Where the data is stored

In IndexedDB, in the extension's own origin (database `applyonce`, object store `records`,
key `profile`; saved field mappings under the key `savedMappings`). Data stays in this Chrome profile on this device and is deleted if the
extension is uninstalled. Nothing is sent anywhere; there is no backend.

Storage code lives only in the extension (`apps/chrome-extension/src/storage`), behind the
`LocalStore` interface from `packages/core`. Two version numbers exist:

- `Profile.schemaVersion` (currently 4): the shape of the profile. Loading a profile with an
  unknown or newer version fails loudly instead of discarding it; migrations live in
  `packages/profile/src/migrate-profile.ts`. **Clear profile** deletes the whole profile,
  records included; saved field mappings are kept.
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
4. Optional: use **Teach** (unknown and review fields) or **Change** (any matched field) to
   pick the right profile field yourself. See [Teach Once](#teach-once).
5. Click **Fill N selected fields**. Each field then shows Filled, Skipped, Failed, or Not
   found, and a summary line such as "8 fields filled · 1 failed · 1 need review".
6. Check the page and submit it yourself. ApplyOnce never submits.

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
| Label is an ambiguous word ("Company", "Experience", "Title", "Education")        | 40     |
| Nearby text or fieldset legend equals a known phrase                              | 30     |
| Field type suits the profile field (only adds to a text match)                    | 10     |

An ambiguous word on its own therefore reaches review at most; it needs corroborating
evidence (e.g. `name="employer"`) to become High. Scores are capped at 100. **High** (≥ 90) → status _mapped_, pre-selected. **Medium** (70–89)
and **Low** (40–69) → status _review_, selectable but never pre-selected. Below 40 → _unknown_,
never filled. If a second profile field also scores ≥ 50, the result is capped at Medium
(a _conflict_). A match the field cannot hold (e.g. an email into a checkbox) or a hidden or
disabled field is _unsupported_. The weights are provisional, to be tuned on real forms.

### Teach Once

When ApplyOnce can't map a field, or maps it wrongly, click **Teach** or **Change** under
it, choose a profile field, and **Save mapping**.

- The selector lists only profile fields this kind of field can hold, built from the
  canonical profile field definitions (`PROFILE_FIELDS` in `packages/core`). There is no
  free-text value entry.
- The field then shows **Taught by you** (instead of _Automatic_). It is not selected:
  tick it and click Fill as usual. Teaching or changing a mapping never fills anything, and
  a changed mapping always has to be approved again.
- The mapping is saved and reused on later analyses, on any site where the same question
  appears. It is shown as taught there too, and is never pre-selected.
- **Saved mappings** (popup footer, or the bottom of the profile page) lists every taught
  mapping: the field's question, its type, the profile field, the site where it was taught,
  and when. **Delete** removes one; **Delete all mappings…** asks for confirmation first.
  After deleting, re-analyze and automatic mapping applies again. Deleting mappings never
  changes your profile, and clearing your profile never deletes mappings.

**How a field is recognized (mapping key).** A saved mapping is keyed on the field type
plus the field's whole normalized question: its label, else aria-label, else placeholder,
else nearby text. When the question comes from the field's own label, a surrounding
fieldset legend is included as context. `name`/`id` are used only when the field has no
text at all. Fields with none of these cannot be taught.

This is safe because matching is exact equality of the whole normalized question, never
containment or similarity: "Preferred working location" and "Current location" have
different keys, and "Phone" under "Emergency contact" differs from "Phone" under "Your
details". Formatting differences such as case, punctuation, or a trailing `*` don't matter.
The URL is not part of the key, so a mapping taught on one site applies to the same
question elsewhere.

**Precedence** for each field:

1. A saved mapping with the same key whose profile field this field can hold → _taught_.
   A saved mapping that no longer fits the field is ignored.
2. The deterministic matcher → _mapped_ (high confidence) or _review_.
3. Otherwise → _unknown_.

At fill time the service worker repeats this check, so an approval for a mapping that has
since been deleted or changed is refused.

### Filling

- Text-like fields: the value is written with the element's native setter, then `input` and
  `change` events are dispatched, so React, Vue, Angular and plain listeners see the change.
  Fields that already have a value (anything but whitespace) are **skipped**, never
  overwritten.
- Select and radio: matched by exact option value, then normalized value, then normalized
  label, then value or label ignoring spaces and punctuation ("onsite" = "On-site"). Always
  whole-text equality: "Remote / Hybrid" is not "remote". No match or several matches means
  **failed**, and the selection is left alone.
- Checkbox: an unchecked box is checked with a real `click()` when your profile says yes.
  A checked box is never unchecked. Radio group: the one option that matches is clicked
  (booleans match Yes/No options), but never when an option is already chosen.
- Selects keep an existing choice: a non-empty option that is not the first one, or that the
  page marked `selected`, counts as a value. Empty placeholder, disabled, and hidden options
  are never chosen.
- Read-only, hidden, and disabled fields are skipped. Off-screen fields are filled (being
  outside the viewport does not make a field invalid).
- Before filling, the service worker checks each approval against the current saved
  mappings, assignments, and profile (a deleted or changed mapping or assignment is refused;
  the value is looked up now, never cached from Analyze), then asks the page for a fresh scan
  and refuses any field whose identity changed since Analyze. The page then scans again
  itself, locates each field by its deterministic id, and checks its name, id, question,
  type, record, repetition, and state. A removed or replaced field is **not found**, a
  changed one is **skipped**; the others are still filled.
- Phone fields that the page reformats ("+1 555-010-0199") count as filled only when exactly
  the same digits remain. Every other value must be kept exactly.
- Filling never submits, clicks buttons, or touches fields that were not approved. While
  filling, any form submission or script-driven navigation the page attempts is cancelled,
  and the field being filled is reported as failed (see Platforms and adapters).

## Generic form compatibility

What the generic adapter handles, and how. Everything is deterministic; nothing is
inferred by similarity.

**Labels.** In order: `<label for>` and wrapping `<label>`, then `aria-labelledby` (several
ids joined in order), then a **wrapper label**: a `<label>` without `for` in the smallest
wrapper (at most three levels up, never past a form, fieldset, or body) that contains only
this field and exactly one such label, as in
`<div><label>First name</label><div><input></div></div>`. A wrapper with another field in
it ends the search, so a label is never taken from a neighbour. Text marked
`aria-hidden="true"` (decorative asterisks) is ignored. `aria-label`, placeholder,
`autocomplete`, and fieldset legend or preceding text are also read, as before.

**Question normalization.** Case, whitespace, and punctuation are ignored, and required or
optional markers are removed: "First Name _", "_ First Name", "First Name (required)",
"First Name - required", and "First Name [optional]" are all "first name". Only marked
forms are removed, so "Is sponsorship required?" keeps its last word. Different wordings
are equivalent only through explicit aliases ("LinkedIn", "LinkedIn URL", "LinkedIn
Profile").

**Autocomplete** tokens map only to canonical profile fields: `given-name`,
`additional-name`, `family-name`, `name`, `email`, `tel`, `tel-national`,
`street-address`, `address-line1`, `address-level2`, `address-level1`, `postal-code`,
`country`, `country-name`, `organization`, `organization-title` (section and
shipping/billing prefixes are ignored). Any other token (e.g. `off`, `url`, `bday`,
`cc-number`) is not evidence.

**Radio groups** are grouped by `name` within a form; the question comes from the fieldset
legend, a `role="radiogroup"` label, or preceding text. Two groups are never merged because
their labels look alike.

**Checkboxes.** A single checkbox is a yes/no field. Checkboxes that share a `name` in the
same form are a **multi-option group** ("Preferred locations: ☐ Ahmedabad ☐ Mumbai"). The
profile holds single values only, so group options are never filled or taught: they show
"One option of a multi-choice group" (or "No safe match") and stay untouched.

**Custom dropdowns (ARIA comboboxes and listbox buttons).** Supports common ARIA
combobox patterns, identified only by semantics, never by CSS class names:

- `<input role="combobox">`, another element with `role="combobox"`, or a trigger with
  `aria-haspopup="listbox"` (typically a `<button>`);
- which declares its popup through `aria-controls`, `aria-owns`, or `aria-expanded`
  (a control with none of these is reported as "cannot operate safely" and never touched);
- whose popup is an element with `role="listbox"` containing `role="option"` elements,
  referenced by `aria-controls`/`aria-owns` (directly, or as the single listbox inside the
  referenced element) or through `aria-activedescendant`. The listbox may live anywhere,
  e.g. rendered at the end of `<body>` (a portal), and may be created only when opened,
  with options that appear a moment later.

The control is one field of type _select_: its trigger, inner search input, hidden native
input (`aria-hidden`), and options are not separate fields, and it maps (and is taught)
exactly like a native `<select>` with the same question. The trigger's own text is its
current value, never its question; a self-reference in `aria-labelledby` is ignored.

Filling, only after approval, one control at a time:

1. An input combobox that already contains text is left alone.
2. The control is opened with standard DOM interaction: a press (`pointerdown`,
   `mousedown`), then, only if nothing opened, the rest of a click; for `role="combobox"`,
   ArrowDown as a last resort. A trigger that is a submit button is never clicked.
3. The listbox is found only through the relationships above. None: "did not appear".
   More than one: fails ("Several lists are attached to this control"). Multi-select lists
   (`aria-multiselectable`) are refused.
4. An existing selection is kept: an option with `aria-selected="true"`, or a control
   whose displayed value equals an option. Only "Select…"-style text that is not an option
   counts as empty.
5. Options are read by accessible label (aria-label, aria-labelledby, else visible text
   without `aria-hidden` decorations such as ✓) and optional value metadata (`data-value`
   or `value`), then matched with the same rules as native selects: exact value,
   normalized value, normalized label, then ignoring spacing/punctuation. No substring,
   prefix, or similarity matching: "Remote / Hybrid" and "Remote work" never match
   "remote"; two matching options fail. Disabled or hidden options are ignored; an option
   that is itself a submit button is never clicked.
6. The one matching option is clicked, and success requires confirmation: the option (or
   its re-rendered equivalent) becomes `aria-selected`, or the control shows its label. For
   widgets that show the value elsewhere, the popup is opened once more to check
   `aria-selected`. No confirmation → "Unable to confirm the selection."
7. Any outcome other than success closes the popup with Escape. Waits are bounded (about
   1.5 s per step); a failure never stops the other fields.

Verified in real Chrome with vanilla ARIA widgets (input combobox, button + listbox,
listbox created on open with delayed options and `aria-controls` only while open, portal
listbox with a hidden native input, a widget showing its value outside the control) and
with the same dropdown patterns implemented in React 19 (including a portal), Vue 3.5
(including `Teleport`), and Angular 22. The actual MUI or react-select libraries were
**not** tested; only their DOM/ARIA behavior was reproduced.

**Rich text / `contenteditable`: not supported.** Editors built on `contenteditable`
(ProseMirror, Draft.js, Quill, Slate, …) keep their own document model; writing DOM text
behind their back can be ignored or corrupt their state, and the only broadly understood
insertion path (`execCommand('insertText')`) needs focus and moves the page's selection.
That cannot be made safe and deterministic generically, so these regions are not detected.

**Dynamic pages.** There is no background observer. Analyze captures the page as it is now;
after the page changes (fields appear, disappear, or re-render), click **Analyze again**:
the review is rebuilt from scratch (removed fields disappear, new ones appear, mappings
and saved mappings are re-applied, and no earlier approval carries over). Fill always
re-scans first: a re-rendered equivalent element is filled, a removed or changed one is
reported as not found.

**Verified in real Chrome** (Chrome 153, fake data) with the same form in plain HTML, React
19 (controlled inputs), Vue 3.5 (`v-model`), and Angular 22 (`[(ngModel)]`, zoneless):
Analyze leaves page and framework state unchanged; Fill updates the visible value and the
framework's state (text, email, tel, number, URL, select, radio, checkbox); existing values
are kept; review, unknown, and checkbox-group fields stay untouched; removed and
re-rendered fields are handled; a field added later is found by Analyze again. The adapter
uses only standard DOM behavior, with no framework-specific code.

## Platforms and adapters

**Supported platforms.** Generic forms (any page), Workday (the current application step),
and Greenhouse (public job-board application forms). No platform is claimed to be fully
supported: see each section for exactly what was verified.

**Architecture.** Every page goes through the same lifecycle:

```text
platform resolver → adapter scan → FormField[] (common metadata) → deterministic mapper
→ profile lookup → review and approval → fill (re-checked) → one result per field
```

Only detection, scan rules, and a few control-specific fill hooks differ per platform
(Workday: search fields; Greenhouse: reading react-select's shown selection). The mapper,
profile, Teach Once, record assignment, field identity, approval, fill pipeline, and results
are shared. Platform selectors stay in each adapter's `selectors.ts`.

**Platform resolver.** Each site adapter reports how strongly the page shows its platform:
_host_ (one of its own hostnames), _structure_ (its own page structure, rendered), _weak_
(something other sites could share), or _none_. Rules, in order:

1. Only host and structure evidence select an adapter; weak evidence never does, however
   many weak signals there are.
2. The strongest evidence wins: a Greenhouse host with a Workday-like container is
   Greenhouse, and a Workday host with a Greenhouse-like form is Workday.
3. Equally strong evidence for two platforms (e.g. both page structures on one page) is a
   conflict: the generic adapter is used. There is no arbitrary winner, and the order in which
   adapters are listed never matters.
4. Otherwise the generic adapter. A detector that fails counts as no evidence.

Hosts are compared after normalization (lowercase, no trailing dot, port ignored): Workday
needs a proper subdomain of its domains, Greenhouse an exact job-board host. Look-alikes
(`evilmyworkdayjobs.com`, `myworkdayjobs.com.example.org`,
`job-boards.greenhouse.io.example.org`) and localhost fixtures get no host evidence. DOM
evidence counts only when it is rendered: hidden markup, `<template>` content, and platform
names in text are ignored.

**When a platform adapter cannot read a page.** If the selected adapter cannot scope the page
safely (e.g. two rendered application containers where there should be one), Analyze shows
"ApplyOnce cannot read the form on this page safely, so it will not fill it. Nothing was
changed." and offers nothing to fill. If this happens at Fill time, every field is reported
as unsupported. The page is never handed to another adapter after being partly read, which
could produce conflicting fields.

**Approvals are re-checked before anything is filled.** In the service worker: the current
mapping, saved mapping, or assignment must still give the approved profile field; the value
is read from the profile now; and a fresh scan of the page must show the field with the same
identity as at Analyze. The page then re-checks the field itself. So a field that was
removed, replaced, relabeled, moved to another section, retyped, repeated, disabled, or made
read-only, a mapping or assignment that was deleted or changed, and a deleted record are all
refused; a profile edit is picked up. Field fingerprints are compared in the service worker
and never sent to the page.

**Failure isolation and results.** Every field gets one of the standard results (filled,
skipped, failed, not found, unsupported) with a short message that never repeats the value.
One field's failure, including an error in a platform hook, never stops the others. Messages
never show selectors, element ids, fingerprints, or error details.

**Submission and navigation safety.** ApplyOnce works on the current page only and never
clicks Next, Continue, Save, Save and Continue, Submit, Apply, Finish, or Back, even when
such a button is a dropdown trigger or an option. Its only interactions are: writing values
(native setter + `input`/`change`), a real `click()` on the chosen checkbox or radio, pointer
events on a dropdown trigger (the click half is never sent to a submit button) and on the
chosen option, `ArrowDown`/`Escape` keys on dropdowns and search fields, and focus on a
search field. As a safety net, while a fill runs, any form submission is cancelled before
the page's handlers see it, and a script-generated click on a link that would leave the page
is cancelled; the field being filled is then reported as failed. Real clicks by the user are
never blocked, and the guard is removed when the fill ends. A page script that calls
`form.submit()` directly or assigns `location` fires no event and cannot be intercepted.

**Verification (Phase 16).** A shared fixture matrix (the same questions on a generic, a
Workday-structured, and a Greenhouse-structured page) runs in unit tests and in real Chrome:
detection, scanning, mapping, every control type, existing values, repeated questions and
record assignment, Teach Once, dynamic questions, re-renders, stale approvals, failure
isolation, submission safety, privacy, and the build handshake. Real sites: see Workday and
Greenhouse.

## Workday

**What it is.** A thin adapter over the generic one. Only platform detection and field
identification are Workday-specific; mapping, Teach Once, the review popup, and filling
(native inputs, selects, and the custom-dropdown engine) are exactly the generic ones.

**What it was built from.** A public Workday candidate site was inspected in Chrome
(read-only: job search, job posting, "Start Your Application", and the apply flow's sign-in
step). Observed: `data-automation-id` attributes on containers and controls, page containers
`jobSearchPage`, `jobPostingPage`, `applyAdventurePage`, `applyFlowPage` (with a
`progressBar`), `data-uxi-widget-type` attributes, generated element ids, and header chrome
whose language selector is an `aria-haspopup="listbox"` submit button. The application
questions themselves sit behind sign-in, which ApplyOnce never automates, so they could not
be observed: the adapter relies on no field-level automation id values, and all selectors
live in `adapters/workday/src/selectors.ts`.

**Detection** (`detectWorkday`): a Workday host (a subdomain of `myworkdayjobs.com`,
`myworkdaysite.com`, or `myworkday.com`; never a look-alike such as `evilmyworkdayjobs.com`)
is host evidence; a rendered page container above is structure evidence; otherwise both many
distinct rendered `data-automation-id` values (≥ 10) and Workday widget-type attributes
together are structure evidence, and one of them alone is only weak. Hidden markup and the
word "Workday" in page text are never evidence. Anything below structure uses the generic
adapter, so a weak signal cannot break an ordinary form. Tenants on their own domains are
recognised by the page containers. Two rendered application step containers cannot be
scoped safely: the page is reported as unreadable (see Platforms and adapters).

**Scanning** (`scanWorkday`, generic scanner plus Workday rules):

- only the application step (`applyFlowPage`) when present, never the header, navigation,
  or footer (so the language selector is not a field);
- field identity from the control's `data-automation-id`, not generated ids, so a step that
  re-renders with new ids is still filled; generated ids are dropped from the field;
- one logical field per Workday field: a hidden text input next to a visible control in the
  same automation container is a helper, not a field;
- **search fields** (`aria-autocomplete="list"`/`"both"`, e.g. "School or University")
  are one logical field of type _text_ and are filled as described in
  [Search fields](#search-fields-workday-autocomplete);
- headed record blocks ("Work Experience 1", "Work Experience 2", …) are repeated sections
  (see [Repeated application sections](#repeated-application-sections)); any other question
  that appears more than once on the step is repeated without record context and never
  filled (see [Repeated questions](#repeated-questions-without-record-context)). A single
  section's fields fill normally.

**Supported controls:** text-like inputs, native selects, radio groups, single checkboxes,
Workday dropdowns that expose ARIA listbox relationships (through the generic custom
dropdown engine), and search fields (below). A dropdown or search field without such
relationships is reported as unsupported.
Demographic, self-identification, and consent checkboxes only match if they are canonical
profile fields, which they are not.

**Current step only.** ApplyOnce never navigates: it never clicks Next, Continue, Save and
Continue, Back, Submit, Apply, or "Add" buttons for new education or work-experience rows.
Fill the step, move on yourself, then Analyze again. No resume or file upload, no sign-in,
account creation, password, or one-time-code handling.

Workday is configurable per tenant: sections, questions, and widgets differ between
companies and application templates, so not every Workday form is supported.

### Search fields (Workday autocomplete)

Workday asks for things like the school, field of study, or location through a text input
that searches as you type and offers suggestions. ApplyOnce fills one only after you
approved it, in these steps (`adapters/workday/src/search-input.ts`):

1. **Detection.** A text input (or input combobox) with `aria-autocomplete="list"` or
   `"both"` is a search field. It is fillable only if it also declares a popup relationship
   (`aria-controls`, `aria-owns`, or `aria-expanded`); otherwise it is unsupported. Ordinary
   text inputs are never treated as search fields. The question comes from the label, never
   from the input's value or the suggestions. Identity is the field's `data-automation-id`,
   so a re-rendered step is still found; nothing from the page is stored.
2. **Existing value.** A field that already has text, a Workday selected-item pill, or a
   selected suggestion is skipped. ApplyOnce never clears a field to search.
3. **Typing.** The approved value is entered once (native value setter and one `input`
   event), with no exploratory or per-character typing. If no suggestions appear, one
   ArrowDown (the standard combobox key) is sent. A widget that ignores script-generated
   input fails safely; there is no workaround.
4. **Suggestions.** The list is found only through `aria-controls`, `aria-owns`, or
   `aria-activedescendant` (never by position or class names). Several lists fail. The
   options must stay unchanged briefly (and the list must not be `aria-busy`), so
   "Searching…" placeholders or late results are not read as the answer. The wait is
   bounded (4 s by default, configurable).
5. **Matching.** The same rules as dropdowns: option value/id, then text ignoring case,
   spacing, and punctuation (accessible text preferred, `aria-hidden` content ignored).
   Exactly one suggestion must match, and no other suggestion may extend the value:
   "University of Example" with suggestions "University of Example" and "University of
   Example, Ahmedabad" is ambiguous and fails, and "Example University" is no match. No
   substring, prefix, fuzzy, or AI matching.
6. **Selection and confirmation.** The suggestion is clicked normally (never by setting
   `aria-selected`); a suggestion that is a submit or navigation button is never clicked.
   Success requires the widget to show the choice: the suggestion marked selected, a
   selected-item pill with its text, or the popup closed with the field showing it.
   Otherwise: "Unable to confirm autocomplete selection."
7. **Failure cleanup.** On any failure the popup is closed and the typed text is removed,
   but only if the field still holds exactly what ApplyOnce typed; the result says whether
   it was removed. Other fields keep filling.

Supported profile fields are those with a plain text value: Institution, Field of study,
City, State / province, Country, and Current company (plus any field you Teach). Yes/no
values are never searched for.

**Verification.** Verified in Chrome on local Workday-style fixtures (plain DOM, React, Vue,
and Angular, with delayed, portal, re-rendered, ambiguous, and no-result cases). A real
Workday application form requires sign-in, which ApplyOnce and its tests never automate, so
search fields have **not** been verified on a real Workday form; only a read-only Analyze of
a public Workday job board was run.

## Greenhouse

**What it is.** A thin adapter over the generic one (`adapters/greenhouse`). Only detection,
the scan scope, and reading react-select's shown selection are Greenhouse-specific. Mapping,
the profile, Teach Once, repeated-field rules, record assignment, field identity, the
review popup, and the fill engines (native inputs, selects, radios, checkboxes, and the
custom-dropdown engine) are exactly the generic ones. All Greenhouse selectors live in
`adapters/greenhouse/src/selectors.ts`.

**What it was built from.** Public Greenhouse job-board pages were inspected read-only
(page source only; nothing was typed, uploaded, or submitted). Observed:
`job-boards.greenhouse.io/<company>/jobs/<id>` serves the application form in the page as
`form#application-form`, with `.application--questions` sections, semantic control ids
(`first_name`, `last_name`, `email`, `phone`, `country`, `question_<n>`), labels linked by
`for`/`aria-labelledby`, and every dropdown built with react-select (`input.select__input`
with `role="combobox"`). Voluntary self-identification questions are in `.eeoc__container`
and `#demographic-section`. The location field is an async lookup. Legacy
`boards.greenhouse.io` URLs redirect to `job-boards`. Company career sites that embed
Greenhouse (their own domain, or an iframe) are not Greenhouse pages to ApplyOnce.

**Detection.** Greenhouse when either holds, otherwise the generic adapter:

- host evidence: the page's host is exactly a Greenhouse job-board host
  (`job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`,
  `boards.eu.greenhouse.io`; case and a trailing dot ignored; not any `*.greenhouse.io` page),
  or
- structure evidence: exactly one rendered `form#application-form` containing a rendered
  `.application--questions` section and at least one rendered `question_<n>` control or
  react-select input.

The word "Greenhouse" in the page text, a generic form, a lone class name, hidden markup,
and a partial or duplicated application form are never enough. Two rendered application
forms on a Greenhouse host cannot be scoped safely: the page is reported as unreadable.

**Scanning.** The generic scanner, scoped to the application form (job description text is
never scanned). Each question is one field: react-select's hidden "required" helper input is
`aria-hidden` and is skipped. Voluntary self-identification sections (gender, race /
ethnicity, veteran, disability, demographic questions) are left out entirely: they are
neither listed nor filled. The location lookup (`#candidate-location`, suggestions only
after typing a search) is listed as **Unsupported**. Greenhouse's ids are authored, stable
ids, so the Phase 14 field identity uses them. Custom questions ("Why us?", legal
agreements, open text) map only when their label matches a profile field by the normal
rules; otherwise they are **No match** and can be taught.

**Supported controls.**

| Control                                 | How it is filled                                               |
| --------------------------------------- | -------------------------------------------------------------- |
| Text, email, tel, URL, number, textarea | generic text filler                                            |
| react-select dropdown                   | generic custom-dropdown engine + react-select selection reader |
| Native select, radio group, checkbox    | generic engines (not seen on sampled boards; fixture-verified) |
| Location lookup                         | unsupported (never typed into)                                 |
| Resume / cover letter upload            | not a field (file inputs are never touched)                    |

react-select shows the chosen option beside an empty input and, on Apple devices, never marks
options `aria-selected`. The generic engine would therefore see "no value" and could not
confirm a choice. The Greenhouse filler passes the generic engine a selection reader (the
`.select__single-value` / `.select__multi-value` text): a dropdown that already shows a
selection is skipped as an existing value, and a new choice counts only when the control
shows it. Option matching is the generic one (value/id, then text ignoring case and
punctuation; exactly one match; no fuzzy matching). Checkboxes follow the generic rule
(scalar yes/no fields only). Voluntary questions never reach a filler.

**Repeated questions, records, Teach Once.** Unchanged generic behavior: identical
questions without record context are **Repeated question** (never filled automatically);
you can assign each copy to a record (Phase 13/14), and Teach Once works as on any page.

**Dynamic forms.** Fill re-scans the page first (no MutationObserver): a question added
after Analyze is found by Analyze again; a field removed or re-rendered with a different
identity since Analyze is reported and not filled.

**Safety.** ApplyOnce never clicks Next, Continue, Save, Apply, Submit, or Back, never
uploads files, never signs in, and never interacts with CAPTCHA. Filling never submits.

**Verification.**

- Unit tests with markup modeled on the observed pages (detection, scanning, EEO
  exclusion, react-select, identity, safety).
- Chrome, on a local React fixture that follows the observed Greenhouse markup and uses the
  real `react-select` library: detection, mapping, filling (text, react-select, native
  select, radio, checkbox), existing values kept, EEO untouched, repeated questions and
  record assignment, Teach Once, a question added after Analyze, re-render, privacy, and no
  navigation or submission.
- Real Greenhouse (Phase 15): read-only Analyze of one public job-board posting in Chrome
  (detected as Greenhouse; standard questions mapped; EEO, resume, and helpers not listed;
  the page was unchanged).
- Real Greenhouse (Phase 16): a fake-data fill of the same public posting's form in
  headless Chrome, with **every write request from the page blocked** (in the final run the page attempted one
  `POST` to `c.spl.greenhouse.io`, which was blocked; an earlier run attempted none),
  the default selection only, nothing uploaded, and the tab closed without submitting.
  First name, last name, email, and LinkedIn were filled and confirmed. The phone number was
  written but reformatted by the page ("+1 555-010-0199"; counted as filled since Phase 16).
  The country dropdown found no unique option for "Canada" and failed safely, leaving it
  empty. One posting only: this is not production validation for Greenhouse forms in
  general.
- Host-only detection is covered by unit tests; it was not isolated in Chrome (local
  fixtures cannot be served on a Greenhouse host).

Not claimed: support for every Greenhouse form. Embedded boards (iframes), company-hosted
career pages, file uploads, the location lookup, and multi-page flows are not supported.

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
- The content script receives only scan requests and the approved field/value pairs with
  the field metadata needed to find each field again (name, id, question, type, record
  position, repeat count). Never the profile, records, record ids, assignments, saved
  mappings, field fingerprints, or schema. This holds for every adapter and platform hook.
- Logging goes through one function (`logFailure`) that records the operation and the
  error type only; a test checks that no other production code logs.
- The scanner collects field metadata only, never page values.
- Saved mappings contain only the mapping key parts (field type and normalized question,
  context, or name), the profile field key, the hostname where it was taught, and
  timestamps. Never form values, profile values, passwords, or page content. Only extension
  pages can list, save, or delete them; content scripts are refused.
- No secrets or API keys in the repository. `.env*` files are git-ignored.

## Intentionally not implemented yet

- Greenhouse: embedded boards (iframes), company-hosted career pages, the location lookup,
  file uploads, voluntary self-identification questions (never filled, by design), and
  broad verification on real Greenhouse forms (one public posting was filled with fake data,
  writes blocked, never submitted)
- Workday multi-page navigation, repeated blocks without record headings, multi-select search fields
  (several pills), replacing an existing search selection, and verification against a real
  Workday application form (it requires sign-in)
- Filling repeated sections without approval, choosing records by content, creating blocks
  ("Add Education"), and continuous DOM observation (see Repeated application sections)
- Editing `legacy` values carried over by migration (they are read-only)
- Scoping saved mappings to a site, similarity-based matching of saved mappings, and
  mapping edits from the management view (delete and re-teach instead)
- Continuous DOM observation (MutationObserver), iframes, shadow DOM, date pickers, file
  uploads
- Custom dropdowns without ARIA relationships, multi-select listboxes, comboboxes that
  only work by typing a search outside Workday, tree/grid/menu popups, and replacing an existing selection
- `contenteditable` / rich-text fields (see Generic form compatibility)
- Multi-option checkbox groups (the profile has no multi-value fields)
- Profile completeness checks
- Editing documents and custom answers in the UI
- Encryption at rest of the local profile
- Android app (`android/` will be added in Phase 7)
- Encrypted sync, backend, accounts
- AI-based field mapping
- CI (GitHub Actions), Playwright and DOM fixture tests, React component tests
