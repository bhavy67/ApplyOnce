import type { FormField } from '@applyonce/core';
import { scanControls, type ScannedField, type ScanOptions } from '@applyonce/adapter-generic';
import { createMappingKey } from '@applyonce/field-mapper';
import {
  APPLICATION_SCOPE,
  AUTOMATION_ID,
  byAutomationId,
  CHROME_CONTAINERS,
  SEARCH_AUTOCOMPLETE_VALUES,
  SEARCH_RELATIONSHIP_ATTRIBUTES,
} from './selectors';

const TEXT_LIKE = new Set(['text', 'email', 'tel', 'number', 'textarea']);

/**
 * Workday scan: the generic scanner, scoped and adjusted with Workday rules.
 *
 * 1. Scope: the application step container when present, else the page, never the site
 *    chrome (header, navigation, footer).
 * 2. Identity: a control's data-automation-id, instead of generated element ids that can
 *    change when Workday re-renders a step. For such controls the generated id is dropped
 *    from the field's signals, so it is neither matched on nor checked when filling.
 * 3. One logical field per Workday field container: a hidden text input next to a visible
 *    control in the same automation container is a helper, not a field.
 * 4. Search-as-you-type inputs (aria-autocomplete list/both) are one text field with the
 *    "search-input" pattern, filled by search-input.ts; they are supported only when they
 *    declare a popup relationship, otherwise reported as unsupported.
 * 5. A question asked several times on the step (repeated record sections such as work
 *    experience) is marked repeated, and is therefore never filled.
 */
export function scanWorkday(root: ParentNode): ScannedField[] {
  const scope = root.querySelector(byAutomationId(APPLICATION_SCOPE)) ?? root;
  return scanControls(scope, WORKDAY_SCAN_OPTIONS);
}

export function scanWorkdayFields(root: ParentNode): FormField[] {
  return scanWorkday(root).map(({ field }) => field);
}

const CHROME_SELECTOR = CHROME_CONTAINERS.map(byAutomationId).join(', ');

const WORKDAY_SCAN_OPTIONS: ScanOptions = {
  exclude: (element) => element.closest(CHROME_SELECTOR) !== null,
  stableIdentity: (element) => element.getAttribute(AUTOMATION_ID) || undefined,
  postProcess: (scanned) =>
    markRepeatedQuestions(dropHiddenHelpers(scanned).map(dropGeneratedId).map(markSearchInput)),
};

function dropGeneratedId(entry: ScannedField): ScannedField {
  if (entry.controls[0]?.hasAttribute(AUTOMATION_ID)) {
    entry.field.signals = Object.fromEntries(
      Object.entries(entry.field.signals).filter(([key]) => key !== 'htmlId'),
    );
  }
  return entry;
}

function markSearchInput(entry: ScannedField): ScannedField {
  const [control] = entry.controls;
  if (control?.tagName !== 'INPUT') return entry;
  const autocomplete = control.getAttribute('aria-autocomplete') ?? '';
  if (!SEARCH_AUTOCOMPLETE_VALUES.includes(autocomplete)) return entry;
  const isTextField = !entry.field.custom && TEXT_LIKE.has(entry.field.type);
  // A generic input combobox with aria-autocomplete is a search field here, not a dropdown.
  if (!isTextField && entry.field.custom?.pattern !== 'input-combobox') return entry;
  entry.field.type = 'text';
  entry.field.htmlType = 'search';
  entry.field.custom = {
    pattern: 'search-input',
    supported: SEARCH_RELATIONSHIP_ATTRIBUTES.some((name) => control.hasAttribute(name)),
  };
  return entry;
}

/** The nearest ancestor carrying a data-automation-id: Workday's field container. */
function automationContainer(entry: ScannedField): Element | null {
  return entry.controls[0]?.parentElement?.closest(`[${AUTOMATION_ID}]`) ?? null;
}

function dropHiddenHelpers(scanned: ScannedField[]): ScannedField[] {
  const containersWithVisibleField = new Set(
    scanned
      .filter((entry) => entry.field.visible)
      .map(automationContainer)
      .filter(Boolean),
  );
  return scanned.filter((entry) => {
    const container = automationContainer(entry);
    const isHelper =
      !entry.field.visible &&
      TEXT_LIKE.has(entry.field.type) &&
      container !== null &&
      containersWithVisibleField.has(container);
    return !isHelper;
  });
}

function markRepeatedQuestions(scanned: ScannedField[]): ScannedField[] {
  const counts = new Map<string, number>();
  const keyOf = (field: FormField) => (field.visible ? createMappingKey(field) : undefined);
  for (const { field } of scanned) {
    const key = keyOf(field);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const { field } of scanned) {
    const count = counts.get(keyOf(field) ?? '') ?? 1;
    if (count > 1) field.repeatedCount = count;
  }
  return scanned;
}
