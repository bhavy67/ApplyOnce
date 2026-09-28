/**
 * Everything Greenhouse-specific the adapter relies on, observed read-only on public
 * Greenhouse-hosted job boards (job-boards.greenhouse.io; legacy boards.greenhouse.io URLs
 * redirect there). Only semantic ids, form/section containers, and the react-select
 * structure Greenhouse renders: never generated CSS classes ("remix-css-…") or positions.
 */

/** Hosts that serve Greenhouse job boards and their application forms. */
export const GREENHOUSE_HOSTS = [
  'job-boards.greenhouse.io',
  'job-boards.eu.greenhouse.io',
  'boards.greenhouse.io',
  'boards.eu.greenhouse.io',
];

/** The application form on a job page. */
export const APPLICATION_FORM = 'form#application-form';

/** Groups of questions inside the application form. */
export const QUESTIONS_SECTION = '.application--questions';

/** Custom questions have ids "question_<number>"; standard ones use semantic ids. */
export const CUSTOM_QUESTION_ID = /^question_\d+$/;

/**
 * Voluntary self-identification (EEO / demographic) sections. Never scanned: their questions
 * are not profile data and must never be taught, mapped, or filled.
 */
export const VOLUNTARY_SECTIONS = [
  '.eeoc__container',
  '#demographic-section',
  '.demographic--container',
];

/**
 * Greenhouse's location question: a react-select that loads suggestions from a location
 * search as you type. ApplyOnce does not type into it, so it is reported as unsupported.
 */
export const LOCATION_SEARCH_IDS = ['candidate-location'];

/** react-select (classNamePrefix "select"), as Greenhouse renders it. */
export const REACT_SELECT = {
  /** The search input that is the combobox. */
  input: 'input.select__input',
  /** The control wrapping the input and the displayed value. */
  control: '.select__control',
  /** The displayed selection (single) and chips (multi). */
  singleValue: '.select__single-value',
  multiValue: '.select__multi-value',
};
