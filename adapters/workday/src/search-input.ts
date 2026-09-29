import type { FillValue } from '@applyonce/core';
import {
  arrowDown,
  clickSequence,
  closePopup,
  EXISTING_VALUE,
  failed,
  filled,
  findListbox,
  findMatchingOption,
  isNavigationAction,
  isSubmitter,
  readOptions,
  sameText,
  setValueWithNativeSetter,
  skipped,
  unsupported,
  waitUntil,
  type CustomControlTiming,
  type CustomOption,
  type Outcome,
} from '@applyonce/adapter-generic';
import { normalizeText } from '@applyonce/field-mapper';
import { SELECTED_ITEM } from './selectors';

/** Suggestions usually come from the server, so the wait is longer than for dropdowns. */
export const DEFAULT_SEARCH_TIMING: CustomControlTiming = { timeoutMs: 4000, intervalMs: 50 };

type Suggestions =
  { kind: 'options'; options: CustomOption[] } | { kind: 'ambiguous-list' } | { kind: 'none' };

/**
 * Fills a search-as-you-type field with one approved value:
 *
 * 1. only an empty field with no selected suggestion is touched;
 * 2. the approved value is entered once (native value setter + input event), with
 *    ArrowDown as the standard fallback if no suggestions appear;
 * 3. the suggestion list is found only through ARIA relationships, and its options are
 *    read once they stop changing (bounded wait);
 * 4. exactly one suggestion must equal the value (same rules as dropdowns), and no other
 *    suggestion may extend it ("University of Example" vs "University of Example,
 *    Ahmedabad" is ambiguous);
 * 5. the suggestion is clicked and the field must show it (or mark it selected).
 *
 * On any failure the popup is closed and the typed text is removed, but only if the field
 * still holds exactly what was typed; nothing else is ever cleared.
 */
export async function fillSearchInput(
  element: HTMLElement,
  value: FillValue,
  timing: CustomControlTiming = DEFAULT_SEARCH_TIMING,
): Promise<Outcome> {
  if (element.tagName !== 'INPUT') return unsupported('This search field is not supported.');
  if (typeof value === 'boolean') return unsupported('A yes/no value cannot be searched for.');
  const input = element as HTMLInputElement;
  if (input.value.trim() !== '' || selectedItems(input).length > 0) return skipped(EXISTING_VALUE);
  const before = findListbox(input);
  if (before instanceof HTMLElement && readOptions(before).some((option) => option.selected)) {
    return skipped(EXISTING_VALUE);
  }

  const query = String(value);
  input.focus({ preventScroll: true });
  setValueWithNativeSetter(input, query);
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: query }),
  );

  const suggestions = await waitForSuggestions(input, timing);
  if (suggestions.kind === 'ambiguous-list') {
    return cleanUp(input, query, failed('Several suggestion lists are attached to this field.'));
  }
  if (suggestions.kind === 'none') return cleanUp(input, query, failed('No suggestions appeared.'));

  const match = matchSuggestion(suggestions.options, value, query);
  if (match === 'ambiguous') {
    return cleanUp(
      input,
      query,
      failed('No unique suggestion matched: several suggestions match.'),
    );
  }
  if (!match) return cleanUp(input, query, failed('No matching suggestion.'));
  if (isSubmitter(match.element) || isNavigationAction(match.element)) {
    return cleanUp(
      input,
      query,
      failed('The suggestion is a submit or navigation button, so it was not clicked.'),
    );
  }

  clickSequence(match.element);
  const confirmed = await waitUntil(() => isConfirmed(input, match) || undefined, timing);
  if (!confirmed) return cleanUp(input, query, failed('Unable to confirm autocomplete selection.'));
  if (input.getAttribute('aria-expanded') === 'true') closePopup(input);
  return filled();
}

/**
 * Waits for the related list to show options, and for those options to stop changing
 * (two identical reads in a row), so late results cannot change the answer afterwards.
 */
async function waitForSuggestions(
  input: HTMLInputElement,
  timing: CustomControlTiming,
): Promise<Suggestions> {
  const deadline = Date.now() + timing.timeoutMs;
  let previous = '';
  let triedArrowDown = false;
  let stableSince = 0;
  let last: Suggestions = { kind: 'none' };
  while (Date.now() < deadline) {
    const listbox = findListbox(input);
    if (listbox === 'ambiguous') return { kind: 'ambiguous-list' };
    const options = listbox ? readOptions(listbox) : [];
    const busy =
      input.getAttribute('aria-busy') === 'true' || listbox?.getAttribute('aria-busy') === 'true';
    const signature = options.map((option) => `${option.value}\u0000${option.label}`).join('\n');
    if (signature !== previous) stableSince = Date.now();
    if (options.length > 0 && !busy) {
      last = { kind: 'options', options };
      if (Date.now() - stableSince >= settleMs(timing)) return last;
    } else if (options.length > 0) {
      last = { kind: 'none' };
    } else if (!triedArrowDown && Date.now() > deadline - timing.timeoutMs / 2) {
      // Standard combobox key to open suggestions, sent once if typing alone did not.
      triedArrowDown = true;
      arrowDown(input);
    }
    previous = signature;
    await new Promise((resolve) => setTimeout(resolve, timing.intervalMs));
  }
  return last;
}

/** Options must stay unchanged this long, so "Loading…" placeholders are not read as results. */
function settleMs(timing: CustomControlTiming): number {
  return Math.min(250, timing.timeoutMs / 4);
}

function matchSuggestion(
  options: CustomOption[],
  value: FillValue,
  query: string,
): CustomOption | 'ambiguous' | undefined {
  const match = findMatchingOption(options, (option) => option, value);
  if (!match || match === 'ambiguous') return match;
  const wanted = normalizeText(query);
  const extended = options.some((option) => {
    const label = normalizeText(option.label);
    return option !== match && label !== wanted && ` ${label} `.includes(` ${wanted} `);
  });
  return extended ? 'ambiguous' : match;
}

/**
 * The click counts only if the widget shows the choice: the option is marked selected, a
 * Workday selected-item pill shows it, or the popup has closed with the field showing it.
 * (The field showing the text alone proves nothing: that is what was typed.)
 */
function isConfirmed(input: HTMLInputElement, option: CustomOption): boolean {
  const pills = input.closest('[data-automation-id^="formField"]')?.querySelectorAll(SELECTED_ITEM);
  if (pills && [...pills].some((pill) => sameText(pill.textContent ?? '', option.label)))
    return true;
  const listbox = findListbox(input);
  const open =
    input.getAttribute('aria-expanded') === 'true' ||
    listbox === 'ambiguous' ||
    (listbox !== undefined && readOptions(listbox).length > 0);
  if (!open && sameText(input.value, option.label)) return true;
  if (option.element.isConnected && option.element.getAttribute('aria-selected') === 'true') {
    return true;
  }
  return (
    listbox instanceof HTMLElement &&
    readOptions(listbox).some(
      (current) => current.selected && sameText(current.label, option.label),
    )
  );
}

/** Workday selected-item pills inside this field's own container. */
function selectedItems(input: HTMLInputElement): Element[] {
  const container = input.closest('[data-automation-id^="formField"]');
  return container ? [...container.querySelectorAll(SELECTED_ITEM)] : [];
}

/** Closes the popup and removes the typed query, only if the field still holds exactly it. */
function cleanUp(input: HTMLInputElement, query: string, outcome: Outcome): Outcome {
  closePopup(input);
  if (input.value === query) {
    setValueWithNativeSetter(input, '');
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }),
    );
    if (input.getAttribute('aria-expanded') === 'true') closePopup(input);
  }
  const note =
    input.value === ''
      ? 'The typed text was removed.'
      : 'The typed text could not be removed; please check this field.';
  return { ...outcome, message: `${outcome.message} ${note}` };
}
