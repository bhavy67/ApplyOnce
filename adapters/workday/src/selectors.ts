/**
 * Every Workday-specific attribute and value the adapter relies on, in one place.
 *
 * Observed on a public Workday candidate site (job search, job posting, "Start Your
 * Application", and the apply-flow sign-in step) in Chrome 153, September 2026. The
 * application form fields themselves were not observable (they require signing in), so
 * nothing here depends on field-level automation id values: those are used only as
 * stable identities, never as meaning.
 */

/**
 * Domains whose subdomains serve Workday candidate sites (e.g. "acme.wd5.myworkdayjobs.com").
 * Only proper subdomains match. Tenants may also use their own domains (detected by page
 * structure instead).
 */
export const WORKDAY_HOST_DOMAINS = ['myworkdayjobs.com', 'myworkdaysite.com', 'myworkday.com'];

/** Workday's stable automation attribute (present on containers, links, and inputs). */
export const AUTOMATION_ID = 'data-automation-id';

/** Workday's widget-type attribute (e.g. "inputField", "button"). */
export const UXI_WIDGET = 'data-uxi-widget-type';

/** Page-level containers of Workday candidate pages. Any one is strong evidence. */
export const PAGE_MARKERS = [
  'jobSearchPage',
  'jobPostingPage',
  'applyAdventurePage',
  'applyFlowPage',
];

/** The application step container. When present, only its content is scanned. */
export const APPLICATION_SCOPE = 'applyFlowPage';

/**
 * Site chrome that never holds application questions: header (with a language selector
 * that is an aria-haspopup="listbox" submit button), navigation, and footer.
 */
export const CHROME_CONTAINERS = [
  'header',
  'navigationContainer',
  'utilityButtonBar',
  'footerContainer',
];

/** Distinct automation ids counted as moderate evidence of a Workday page. */
export const MIN_DISTINCT_AUTOMATION_IDS = 10;

export const byAutomationId = (value: string) => `[${AUTOMATION_ID}="${value}"]`;

/**
 * Search-as-you-type fields (Phase 9). A text input whose aria-autocomplete is one of these
 * values types a query and offers suggestions to choose from.
 */
export const SEARCH_AUTOCOMPLETE_VALUES = ['list', 'both'];

/**
 * A search field is fillable only if it also declares a popup relationship with one of
 * these attributes; the suggestion list itself is then found through aria-controls,
 * aria-owns, or aria-activedescendant (never by position).
 */
export const SEARCH_RELATIONSHIP_ATTRIBUTES = ['aria-controls', 'aria-owns', 'aria-expanded'];

/**
 * Workday shows a chosen suggestion as a "selected item" pill next to the search input
 * (the input itself is cleared). A pill with the suggestion's text inside the field's
 * container confirms the selection.
 */
export const SELECTED_ITEM = byAutomationId('selectedItem');
