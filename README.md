# ApplyOnce

A local-first personal autofill system for repetitive forms, starting with job applications.

ApplyOnce keeps one structured personal profile on your device, detects the fields on a form,
maps them to the profile with an explainable confidence score, and lets you review before
filling. It never submits a form for you. The full product specification is in
[`ApplyOnce_Project_Initial_Spec.md`](./ApplyOnce_Project_Initial_Spec.md).

## Status

**Phase 10 — Repeatable profile records: complete.**

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
  [Repeatable records](#repeatable-records). **Phase 10 stores repeatable profile data. It
  does not yet automatically fill repeated application sections.**

Nothing is ever submitted. Greenhouse gets dedicated support in a later phase; until then
it is handled by the generic adapter.

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
- **Not implemented yet:** filling repeated application sections (e.g. Workday's education
  and work-experience blocks), choosing which record fits which section, and clicking "Add
  Education" / "Add Work Experience". Repeated questions on a page stay unsupported.

### Migration

Profiles are migrated when loaded (`migrateProfile`, pure, deterministic, idempotent, and
non-destructive; the stored data is never modified in place).

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

- `Profile.schemaVersion` (currently 3): the shape of the profile. Loading a profile with an
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
- Before filling, the page is scanned again and each field is located by its deterministic
  id and checked against its metadata from analysis. A removed or replaced field is
  **not found**; the others are still filled.
- Filling never submits, clicks buttons, or touches fields that were not approved.

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

**Detection** (`detectWorkday`): a Workday host (`*.myworkdayjobs.com`,
`*.myworkdaysite.com`, `*.myworkday.com`) or one of the page containers above is enough on
its own; otherwise both many distinct `data-automation-id` values (≥ 10) and Workday
widget-type attributes are required. The word "Workday" in page text is never evidence.
Anything else uses the generic adapter, so a weak signal cannot break an ordinary form.
Tenants on their own domains are recognised by the page containers.

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
- a question that appears more than once on the step (e.g. "Job Title" in two
  work-experience blocks) is marked repeated and never filled: the profile holds only the
  current job and one education record. A single section's fields fill normally.

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
- Saved mappings contain only the mapping key parts (field type and normalized question,
  context, or name), the profile field key, the hostname where it was taught, and
  timestamps. Never form values, profile values, passwords, or page content. Only extension
  pages can list, save, or delete them; content scripts are refused.
- No secrets or API keys in the repository. `.env*` files are git-ignored.

## Intentionally not implemented yet

- Greenhouse extraction and filling (the adapter only recognises its URLs; the generic
  adapter handles those pages)
- Workday multi-page navigation, repeated record sections, multi-select search fields
  (several pills), replacing an existing search selection, and verification against a real
  Workday application form (it requires sign-in)
- Automatically filling repeated application sections from profile records (the records are
  stored and can be targeted with Teach Once; see Repeatable records)
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
