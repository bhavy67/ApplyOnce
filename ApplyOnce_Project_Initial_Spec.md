# ApplyOnce

> **Your information. Once.**

A local-first personal autofill system for repetitive forms, starting with job applications.

---

## 1. Project Overview

ApplyOnce is a personal productivity tool designed to reduce the repetitive work of filling the same personal and professional information into online forms.

The initial problem is simple:

- The same name, email, phone number, location, education, experience, links, work preferences, and other details are entered repeatedly.
- Job portals often use multi-step forms.
- Workday and Greenhouse are common examples.
- Other companies use their own custom forms.
- Manual repetition wastes time and increases the chance of inconsistent or incorrect answers.

ApplyOnce should make this experience:

> **Detect the form → understand the fields → map them to my profile → let me review → fill safely.**

The first target is personal use, not a public SaaS product.

---

# 2. Product Vision

Create one structured personal profile that can be reused across forms.

```text
                 APPLYONCE
                     |
          +----------+----------+
          |                     |
        DESKTOP               ANDROID
          |                     |
    Chrome Extension       Autofill Service
          |                     |
          +----------+----------+
                     |
              Shared Concepts
                     |
       Profile + Field Mapping
                     |
        Form Detection Engine
```

The product should not simply "fill everything."

It should understand:

- What the field means
- Which profile value should be used
- How confident it is
- Whether the user should review it

The human remains in control.

---

# 3. Core Product Rules

## Rule 1: Local-first

The core product must work without a backend.

Personal information should remain on the user's device by default.

## Rule 2: Human-controlled submission

ApplyOnce can fill a form.

ApplyOnce must not automatically submit an application.

```text
Detect
  ↓
Map
  ↓
Fill
  ↓
Review
  ↓
User submits
```

## Rule 3: Deterministic first

Do not make AI the foundation of the product.

Use deterministic matching first:

- field name
- field id
- label
- placeholder
- autocomplete
- input type
- nearby text
- known aliases
- site-specific rules

AI can become a fallback for ambiguous fields later.

## Rule 4: Confidence matters

Every mapping should have a confidence level.

Example:

```text
Email                         99%
Phone                         99%
First Name                    98%
Current Company               96%
Notice Period                 88%
Expected Compensation        61%
Unknown Custom Question       ?
```

High-confidence fields can be filled automatically.

Low-confidence fields should be shown for review.

## Rule 5: Learn from the user

If ApplyOnce cannot confidently understand a field, the user should be able to map it manually.

Example:

```text
Unknown field:
"How soon could you start?"

User selects:
notice_period

[ Remember this mapping ]
```

The next time the field appears, ApplyOnce can recognize it.

---

# 4. Initial Scope

V1 should solve only the most important workflow.

### Target platforms

1. Generic web forms
2. Workday
3. Greenhouse

Do not begin by supporting every job portal.

The architecture should allow additional adapters later.

Possible future adapters:

- Lever
- Ashby
- SmartRecruiters
- iCIMS
- Custom internal portals

These are future possibilities, not V1 requirements.

---

# 5. Primary User Flow

## Desktop

```text
Open job application
        ↓
Open ApplyOnce extension
        ↓
Detect current form
        ↓
Find supported fields
        ↓
Map fields to profile
        ↓
Show confidence
        ↓
User reviews
        ↓
Fill current step
        ↓
User continues to next step
        ↓
Repeat
```

The extension should work well with multi-step forms.

Example:

```text
Workday

Step 1 → Personal Information
Step 2 → Contact Information
Step 3 → Experience
Step 4 → Education
Step 5 → Additional Questions
```

ApplyOnce should understand the current page/step instead of assuming that the entire application exists in one DOM tree.

---

# 6. Android User Flow

Android is a separate client of the same product concepts.

```text
Android App
    |
    +-- Profile
    |
    +-- Settings
    |
    +-- Saved mappings
    |
    +-- Autofill Service
    |
    +-- Quick Settings Tile
```

The Android version should use the Android Autofill Framework rather than trying to imitate browser DOM manipulation.

The Quick Settings tile is a convenience surface, not the core filling mechanism.

---

# 7. Architecture

## High-level architecture

```text
                            APPLYONCE
                               |
              +----------------+----------------+
              |                                 |
          CHROME                              ANDROID
       EXTENSION APP                       NATIVE APP
              |                                 |
              +----------------+----------------+
                               |
                         SHARED DOMAIN
                               |
               +---------------+---------------+
               |               |               |
            PROFILE         MAPPING         ADAPTERS
               |               |               |
               +---------------+---------------+
                               |
                        VALIDATION / RULES
```

---

# 8. Repository Strategy

Use one GitHub repository and one local project directory.

This should be a monorepo.

Recommended starting structure:

```text
applyonce/
│
├── apps/
│   └── chrome-extension/
│
├── android/
│   └── app/
│
├── packages/
│   ├── core/
│   ├── profile/
│   └── field-mapper/
│
├── adapters/
│   ├── generic/
│   ├── workday/
│   └── greenhouse/
│
├── docs/
│
├── README.md
├── package.json
├── pnpm-workspace.yaml
└── .gitignore
```

Do not create unnecessary applications or packages before they are needed.

---

# 9. Technology Stack

## Chrome Extension

```text
TypeScript
React
Vite
Chrome Manifest V3
IndexedDB
chrome.storage
Web Crypto API
```

Responsibilities:

- Detect forms
- Inspect fields
- Map fields
- Display UI
- Fill fields
- Maintain local extension state
- Manage user mappings

---

## Shared TypeScript Core

```text
TypeScript
```

Responsibilities:

- Profile schema
- Field definitions
- Field aliases
- Normalization
- Matching logic
- Confidence scoring
- Validation
- Adapter interfaces
- Shared domain types

The business concepts should remain independent from the Chrome UI.

---

## Android

```text
Kotlin
Jetpack Compose
AutofillService
TileService
Room
Android Keystore
```

Responsibilities:

- Local profile management
- Android Autofill integration
- Quick Settings access
- Secure local storage
- Device-specific settings

Android should not require the Chrome extension.

---

## Testing

```text
Vitest
Playwright
JUnit
Android instrumentation tests
```

---

## CI

```text
GitHub Actions
```

Initial CI responsibilities:

- Type checking
- Linting
- Unit tests
- Chrome extension build
- Android build

---

# 10. Backend Decision

## V1: No backend

The initial product does not need:

- API server
- database server
- authentication service
- cloud storage

Everything should work locally.

---

# 11. Why No Backend Initially?

The product is personal-first.

The main requirements are:

```text
fast
private
offline-capable
simple
reliable
```

A backend introduces:

- authentication
- APIs
- deployment
- security concerns
- synchronization logic
- operational cost

None of those are necessary to prove that the autofill engine works.

Build the core problem first.

---

# 12. Future Sync Architecture

Only introduce a backend when cross-device sync becomes necessary.

Possible future stack:

```text
Supabase
PostgreSQL
Supabase Auth
```

Preferred model:

```text
Mac
  ↓
Local encryption
  ↓
Encrypted profile
  ↓
Cloud sync
  ↓
Encrypted profile
  ↓
Android
  ↓
Local decryption
```

Do not design the first version around plain-text cloud storage of personal information.

---

# 13. Profile Model

The profile is the foundation of ApplyOnce.

Initial conceptual structure:

```text
profile
│
├── identity
│   ├── firstName
│   ├── middleName
│   ├── lastName
│   └── fullName
│
├── contact
│   ├── email
│   ├── phone
│   └── alternatePhone
│
├── location
│   ├── address
│   ├── city
│   ├── state
│   ├── country
│   └── postalCode
│
├── education
│   ├── degree
│   ├── institution
│   ├── graduationYear
│   └── fieldOfStudy
│
├── experience
│   ├── currentCompany
│   ├── currentTitle
│   ├── totalExperience
│   ├── noticePeriod
│   └── workHistory[]
│
├── links
│   ├── linkedin
│   ├── github
│   └── portfolio
│
├── preferences
│   ├── workMode
│   ├── relocation
│   └── employmentType
│
├── authorization
│   ├── workAuthorization
│   └── sponsorship
│
├── documents
│   ├── resumes[]
│   └── coverLetters[]
│
└── customAnswers[]
```

This is a conceptual schema.

Do not implement every property in V1.

Start only with the fields required for the real forms you encounter.

---

# 14. Field Mapping Engine

The mapping engine is the heart of the product.

```text
HTML field
    ↓
Read metadata
    ↓
Normalize text
    ↓
Exact match?
    ↓
Alias match?
    ↓
Known site mapping?
    ↓
Context match?
    ↓
Confidence score
```

Example:

```text
"Professional Experience"
"Years of Experience"
"Total Experience"
"Experience in Years"

                    ↓

             experience_years
```

The mapper should be explainable.

When possible, the system should know why it selected a value.

Example:

```text
Matched by:
✓ label
✓ name
✓ known alias

Confidence: 97%
```

---

# 15. Field Types to Support Initially

The first implementation should support:

```text
text
email
tel
number
textarea
select
checkbox
radio
```

Later:

```text
date
combobox
custom autocomplete
file upload
rich text
custom widgets
```

File upload should be treated separately because browsers intentionally restrict silent programmatic selection of local files.

---

# 16. Generic Form Adapter

The generic adapter should inspect standard browser form metadata.

Useful signals include:

```text
name
id
placeholder
label
aria-label
autocomplete
type
nearby text
select options
```

The generic adapter is the first thing to make reliable.

---

# 17. Workday Adapter

Workday should be treated as a dedicated integration layer.

Responsibilities may include:

```text
page / step detection
field detection
label mapping
select handling
radio handling
checkbox handling
conditional sections
multi-step navigation awareness
```

The adapter should never assume that all Workday pages are identical.

The architecture should allow Workday-specific selectors and mappings to evolve independently from the generic engine.

---

# 18. Greenhouse Adapter

Greenhouse should similarly have its own adapter.

Responsibilities may include:

```text
field detection
label mapping
dropdown handling
radio / checkbox handling
application step awareness
custom question handling
```

Avoid making the whole extension depend on Greenhouse-specific logic.

---

# 19. Confidence Model

A simple first version can use weighted signals.

Example:

```text
Exact field name match       +40
Exact label match            +30
Alias match                  +15
Placeholder match            +10
Input type match             +5
Known site mapping           +20
```

Then normalize to a confidence percentage.

The exact scoring model should be validated through real forms rather than treated as final architecture.

Possible states:

```text
90–100%  → high confidence
70–89%   → review recommended
40–69%   → manual confirmation
0–39%    → unknown
```

Do not treat these thresholds as fixed until real-world data is collected.

---

# 20. "Teach Once" System

This is one of the most important features after basic autofill works.

Flow:

```text
Unknown field
     ↓
User maps field
     ↓
Save mapping
     ↓
Normalize field signature
     ↓
Future matching
```

Example:

```text
"How long would you need before joining?"

        ↓

notice_period
```

Save a reusable mapping.

Possible mapping record:

```text
site
field signature
profile field
user confirmed
created at
last used
```

The system should allow the user to edit or delete saved mappings.

---

# 21. Profile vs Application-specific Answers

Not every answer belongs in the permanent profile.

Separate:

### Stable profile data

```text
name
phone
email
education
experience
links
```

from:

### Application-specific answers

```text
Why do you want to work here?
Why this company?
Salary expectation for this role
Custom application questions
```

This distinction is important.

ApplyOnce should not accidentally reuse a company-specific answer for another company.

---

# 22. Resume Handling

Future feature:

```text
Resume
├── frontend
├── software-engineer
└── general
```

The system may suggest the most relevant resume, but the user should decide which document gets uploaded.

Do not automate file submission blindly.

---

# 23. Security Principles

Personal data may include:

- phone
- email
- address
- work history
- education
- job preferences
- work authorization
- resumes

Therefore:

### Default

```text
Local storage
Minimal permissions
No unnecessary telemetry
No unnecessary external requests
```

### Future cloud

```text
Client-side encryption
Encrypted transport
Minimal server knowledge
Device-specific decryption
```

Never log sensitive profile values for debugging in production builds.

---

# 24. Permissions Principle

Request only the permissions genuinely required.

Avoid broad access just because it is convenient.

The extension should eventually explain:

- why page access is required
- what information is inspected
- what is stored
- whether anything leaves the device

---

# 25. AI Strategy

AI is explicitly a later feature, not the starting point.

## V1

```text
DOM metadata
+
rules
+
aliases
+
normalization
+
site adapters
+
confidence
```

## Later

```text
Unknown / ambiguous field
          ↓
Semantic AI mapper
          ↓
Suggested profile field
          ↓
User confirmation
          ↓
Remember mapping
```

AI should never be required for ordinary fields such as:

```text
First Name
Last Name
Email
Phone
City
LinkedIn
GitHub
Portfolio
```

---

# 26. Observability and Debug Mode

A developer-only debug mode will be useful.

Example:

```text
Field: "Professional Experience"

Detected as:
experience_years

Confidence:
94%

Reasons:
✓ Label match
✓ Alias match
✓ Input type match

Value:
4 years
```

Sensitive values should be masked in debug output where possible.

---

# 27. Testing Strategy

The most important tests are not only UI tests.

## Mapping tests

Input:

```text
"Total years of professional experience"
```

Expected:

```text
experience_years
```

## DOM fixture tests

Create saved HTML fixtures for:

```text
generic
workday
greenhouse
```

Then test that the mapper identifies the expected fields.

## Regression tests

Every time a real-world form causes a mapping bug:

```text
save fixture
+
add regression test
```

The product should become more reliable over time.

---

# 28. Development Phases

## Phase 0 — Foundation

Decide:

- repository structure
- package manager
- TypeScript configuration
- profile schema
- core interfaces
- development conventions

No autofill yet.

---

## Phase 1 — Profile

Build:

```text
profile model
profile editor
local persistence
validation
```

Goal:

> Store and edit personal information cleanly.

---

## Phase 2 — Generic Chrome Autofill

Build:

```text
form detection
field extraction
field normalization
basic mapping
fill engine
extension popup
```

Goal:

> Fill ordinary HTML forms reliably.

---

## Phase 3 — Confidence + Review

Build:

```text
confidence scoring
review UI
unknown fields
manual mapping
```

Goal:

> Make automation safe.

---

## Phase 4 — Workday

Build:

```text
Workday adapter
step awareness
special field handling
regression fixtures
```

Goal:

> Make Workday useful for real applications.

---

## Phase 5 — Greenhouse

Build:

```text
Greenhouse adapter
custom questions
multi-step handling
regression fixtures
```

Goal:

> Cover the second major application platform.

---

## Phase 6 — Teach Once

Build:

```text
saved mappings
field memory
mapping editor
mapping history
```

Goal:

> Make the tool improve through repeated personal use.

---

## Phase 7 — Android

Build:

```text
Android app
AutofillService
profile access
local secure storage
```

Goal:

> Bring the same personal profile to Android.

---

## Phase 8 — Quick Settings

Build:

```text
TileService
quick profile access
settings shortcuts
```

Goal:

> Make common Android actions accessible quickly.

---

## Phase 9 — Encrypted Sync

Only if needed.

Build:

```text
authentication
encrypted sync
device management
conflict handling
```

Potential stack:

```text
Supabase
PostgreSQL
```

---

## Phase 10 — AI

Only after the deterministic system is reliable.

Build:

```text
semantic field matching
ambiguous question suggestions
smarter custom-question mapping
```

AI should remain optional.

---

# 29. Non-goals for V1

ApplyOnce should NOT initially:

- automatically submit applications
- automatically apply to jobs
- bypass CAPTCHAs
- bypass bot detection
- scrape job portals for jobs
- store every job application
- become a job board
- become an ATS
- become a general-purpose browser automation platform
- require a cloud account
- require AI for basic autofill

The focus is:

> **Fill repetitive personal information accurately and safely.**

---

# 30. Future Possibilities

These are ideas for later, not commitments:

```text
Application history
Company-specific answers
Resume recommendations
Cover-letter assistance
More ATS adapters
Cross-device encrypted sync
AI semantic mapping
Analytics
Form change detection
Mapping suggestions
Browser context awareness
```

Do not build these until the core autofill workflow is excellent.

---

# 31. Definition of Done for V1

V1 is successful when:

```text
1. I can maintain my profile locally.

2. I can open a normal web form.

3. ApplyOnce detects common fields.

4. ApplyOnce maps them to my profile.

5. I can see confidence / review information.

6. I can fill the current form.

7. Unknown fields remain untouched.

8. Workday works for the common flows I actually use.

9. Greenhouse works for the common flows I actually use.

10. I can manually teach an unknown field.

11. The mapping is remembered.

12. No application is automatically submitted.

13. Sensitive profile data stays local.
```

---

# 32. Product Success Metric

Do not measure success by number of features.

Measure:

```text
time saved per application
fields correctly filled
manual fields remaining
incorrect autofills
unknown fields
successful Workday applications
successful Greenhouse applications
```

The most useful metric is probably:

> **How much time does ApplyOnce save me per application without increasing mistakes?**

---

# 33. Development Philosophy

ApplyOnce should favor:

```text
simple > clever
local > cloud
deterministic > probabilistic
explainable > magical
safe > fully automatic
measured > assumed
```

Avoid premature abstraction.

Avoid building infrastructure before it is needed.

Avoid adding AI because it sounds impressive.

The best version of ApplyOnce is the one that quietly saves time every day.

---

# 34. Initial Project Identity

## Name

**ApplyOnce**

## Tagline

**Your information. Once.**

## Core promise

> Fill your information once. Reuse it wherever you apply.

## Product personality

```text
private
fast
minimal
reliable
personal
quietly intelligent
```

It should feel like a useful personal tool, not an enterprise SaaS dashboard.

---

# 35. Immediate Next Step

The folder already exists.

The next step is to initialize the repository and build the foundation before implementing autofill.

The first implementation task should establish:

```text
repository
monorepo
TypeScript
workspace structure
core package
profile package
field types
basic interfaces
linting
formatting
testing
README
```

After that, move into the first actual feature:

> **Local personal profile + generic form detection.**

---

# 36. Guiding Question

Whenever a new feature is proposed, ask:

> **Does this make filling a real form faster, safer, or more reliable?**

If the answer is no, it probably does not belong in the current phase.

---

# 37. Long-term Vision

ApplyOnce should eventually feel like this:

```text
             YOU
              |
       One trusted profile
              |
     +--------+--------+
     |                 |
     MAC             ANDROID
     |                 |
   Browser           Apps
     |                 |
     +--------+--------+
              |
        Smart mapping
              |
        Safe autofill
              |
        You stay in control
```

The complexity should stay behind the scenes.

The user experience should remain simple:

> **Open form.  
> ApplyOnce understands it.  
> Review.  
> Fill.  
> Move on.**
