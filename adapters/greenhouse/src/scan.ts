import type { FormField } from '@applyonce/core';
import { scanControls, type ScannedField, type ScanOptions } from '@applyonce/adapter-generic';
import { APPLICATION_FORM, LOCATION_SEARCH_IDS, VOLUNTARY_SECTIONS } from './selectors';

/**
 * Greenhouse scan: the generic scanner, scoped and adjusted with Greenhouse rules.
 *
 * 1. Scope: the application form when present, else the page (job description text and
 *    board navigation are never fields).
 * 2. Voluntary self-identification (EEO / demographic) sections are left out entirely.
 * 3. Identity: Greenhouse's semantic control ids ("first_name", "question_123…") are
 *    authored, stable ids, so the generic scanner already uses them (and the Phase 14 field
 *    identity includes them). react-select's hidden "required" helper input is aria-hidden,
 *    so it is not a field; each question is one field.
 * 4. The location lookup (suggestions only after typing) is reported as unsupported.
 *
 * Everything else (labels via for/aria-labelledby, required markers, repeated questions,
 * record sections, field identity) is the generic scanner's.
 */
export function scanGreenhouse(root: ParentNode): ScannedField[] {
  const scope = root.querySelector(APPLICATION_FORM) ?? root;
  return scanControls(scope, GREENHOUSE_SCAN_OPTIONS);
}

export function scanGreenhouseFields(root: ParentNode): FormField[] {
  return scanGreenhouse(root).map(({ field }) => field);
}

const VOLUNTARY_SELECTOR = VOLUNTARY_SECTIONS.join(', ');

const GREENHOUSE_SCAN_OPTIONS: ScanOptions = {
  exclude: (element) => element.closest(VOLUNTARY_SELECTOR) !== null,
  postProcess: (scanned) => scanned.map(markLocationSearch),
};

function markLocationSearch(entry: ScannedField): ScannedField {
  const [control] = entry.controls;
  if (control && LOCATION_SEARCH_IDS.includes(control.id)) {
    entry.field.type = 'text';
    entry.field.htmlType = 'search';
    entry.field.custom = { pattern: 'search-input', supported: false };
  }
  return entry;
}
