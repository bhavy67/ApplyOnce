import type { FillValue } from '@applyonce/core';
import { normalizeText } from '@applyonce/field-mapper';
import { ariaLabelledByText, attributeText, textOf } from './field-text';
import { EXISTING_VALUE, failed, filled, skipped, unsupported, type Outcome } from './fill-outcome';
import { findMatchingOption } from './option-match';
import { isVisible } from './visibility';

/** Bounded waits for widgets that render asynchronously (popup, options, confirmation). */
export interface CustomControlTiming {
  /** Longest wait for each step. */
  timeoutMs: number;
  intervalMs: number;
}

export const DEFAULT_CUSTOM_CONTROL_TIMING: CustomControlTiming = {
  timeoutMs: 1500,
  intervalMs: 25,
};

export interface CustomOption {
  element: HTMLElement;
  /** Accessible label: aria-label, aria-labelledby, else visible text (aria-hidden excluded). */
  label: string;
  /** Explicit value metadata (data-value or value attribute), if the page exposes one. */
  value: string;
  selected: boolean;
}

/**
 * Selects one option in a custom single-select control (ARIA combobox or listbox popup
 * button), using only standard DOM interaction:
 *
 * 1. an input combobox that already contains text is left alone;
 * 2. the popup is opened: press (pointerdown/mousedown), then, only if nothing opened, the
 *    rest of a click; for role="combobox", ArrowDown as a last resort;
 * 3. the listbox is found only through aria-controls / aria-owns (or the active
 *    descendant): never by position, so portals work and ambiguity fails;
 * 4. an existing selection (aria-selected, or the displayed value equal to an option) is
 *    kept;
 * 5. the profile value is matched with the same deterministic rules as native selects;
 * 6. the one matching option is clicked, and the change must be observable (aria-selected
 *    or the displayed value), re-opening once to check if needed.
 *
 * Anything that is not clearly successful closes the popup (Escape) and fails safely.
 *
 * `options.selection` is for widgets that show the current selection outside the control
 * and do not mark options aria-selected (a site adapter knows where): it returns the
 * displayed selection ("" when none), and is used both to keep an existing selection and to
 * confirm the new one.
 */
export interface CustomSelectOptions {
  /** The selection the widget currently shows for this control ("" when none). */
  selection?: (control: HTMLElement) => string | undefined;
}

export async function fillCustomSelect(
  control: HTMLElement,
  value: FillValue,
  timing: CustomControlTiming = DEFAULT_CUSTOM_CONTROL_TIMING,
  options: CustomSelectOptions = {},
): Promise<Outcome> {
  if (control.tagName === 'INPUT' && (control as HTMLInputElement).value.trim() !== '') {
    return skipped(EXISTING_VALUE);
  }
  if (isNavigationAction(control)) {
    return failed('The control is a navigation or submit button, so it was not clicked.');
  }
  const shown = (element: HTMLElement) => options.selection?.(element) ?? displayedValue(element);
  const displayedBefore = shown(control);
  // A selection shown by the widget is kept, without even opening it.
  if (options.selection && displayedBefore !== '') return skipped(EXISTING_VALUE);

  const listbox = await openListbox(control, timing);
  if (listbox === 'ambiguous')
    return closeWith(control, failed('Several lists are attached to this control.'));
  if (!listbox) return closeWith(control, failed('The list of options did not appear.'));
  if (listbox.getAttribute('aria-multiselectable') === 'true') {
    return closeWith(control, unsupported('Multi-select lists are not supported.'));
  }

  const listed = await waitUntil(() => {
    const found = readOptions(listbox);
    return found.length > 0 ? found : undefined;
  }, timing);
  if (!listed) return closeWith(control, failed('The list has no options.'));

  const hasSelection =
    listed.some((option) => option.selected) ||
    (displayedBefore !== '' && listed.some((option) => sameText(option.label, displayedBefore)));
  if (hasSelection) return closeWith(control, skipped(EXISTING_VALUE));

  const match = findMatchingOption(listed, (option) => option, value);
  if (match === 'ambiguous') {
    return closeWith(control, failed('No unique option matched: several options match.'));
  }
  if (!match) return closeWith(control, failed('No unique option matched.'));
  if (isSubmitter(match.element) || isNavigationAction(match.element)) {
    return closeWith(
      control,
      failed('The option is a submit or navigation button, so it was not clicked.'),
    );
  }

  clickSequence(match.element);
  const confirmed =
    (await waitUntil(() => isConfirmed(control, match, shown) || undefined, timing)) ??
    (await confirmByReopening(control, match.label, timing));
  if (isExpanded(control)) closePopup(control);
  return confirmed ? filled() : failed('Unable to confirm the selection.');
}

/** The listbox this control declares, after opening it if needed. */
async function openListbox(
  control: HTMLElement,
  timing: CustomControlTiming,
): Promise<HTMLElement | 'ambiguous' | undefined> {
  const current = findListbox(control);
  if (current && isExpanded(control)) return current;

  const steps: (() => void)[] = [() => press(control), () => release(control)];
  if (control.getAttribute('role') === 'combobox') steps.push(() => arrowDown(control));
  const stepTiming = { ...timing, timeoutMs: Math.min(400, timing.timeoutMs) };
  for (const step of steps) {
    step();
    const found = await waitUntil(() => findListbox(control), stepTiming);
    if (found) return found;
  }
  return undefined;
}

/**
 * The single visible listbox referenced by aria-controls / aria-owns (an element with
 * role="listbox", or a container holding exactly one), else the listbox of the option named
 * by aria-activedescendant. More than one candidate is ambiguous.
 */
export function findListbox(control: HTMLElement): HTMLElement | 'ambiguous' | undefined {
  const document = control.ownerDocument;
  const ids = ['aria-controls', 'aria-owns'].flatMap(
    (name) => control.getAttribute(name)?.split(/\s+/).filter(Boolean) ?? [],
  );
  const candidates = new Set<HTMLElement>();
  for (const id of ids) {
    const element = document.getElementById(id);
    if (!element) continue;
    if (element.getAttribute('role') === 'listbox') {
      candidates.add(element);
      continue;
    }
    const inner = element.querySelectorAll<HTMLElement>('[role="listbox"]');
    if (inner.length > 1) return 'ambiguous';
    if (inner[0]) candidates.add(inner[0]);
  }
  if (candidates.size === 0) {
    const activeId = control.getAttribute('aria-activedescendant');
    const active = activeId ? document.getElementById(activeId) : null;
    const listbox = active?.closest<HTMLElement>('[role="listbox"]');
    if (listbox) candidates.add(listbox);
  }
  const visible = [...candidates].filter(isVisible);
  if (visible.length > 1) return 'ambiguous';
  return visible[0];
}

/** Enabled, visible role="option" elements with their accessible label and value metadata. */
export function readOptions(listbox: HTMLElement): CustomOption[] {
  return Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'))
    .filter((element) => element.getAttribute('aria-disabled') !== 'true' && isVisible(element))
    .map((element) => ({
      element,
      label:
        attributeText(element, 'aria-label') ??
        ariaLabelledByText(element) ??
        textOf(element) ??
        '',
      value: element.getAttribute('data-value') ?? element.getAttribute('value') ?? '',
      selected: element.getAttribute('aria-selected') === 'true',
    }))
    .filter((option) => option.label !== '' || option.value !== '');
}

/** What the control currently shows: an input's value, else its own visible text. */
function displayedValue(control: HTMLElement): string {
  if (control.tagName === 'INPUT') return (control as HTMLInputElement).value.trim();
  return textOf(control) ?? '';
}

/**
 * The selection is visible: the chosen option (or, after a re-render, the option with the
 * same label in the current listbox) is aria-selected, or the control shows its label.
 */
function isConfirmed(
  control: HTMLElement,
  option: CustomOption,
  shown: (element: HTMLElement) => string = displayedValue,
): boolean {
  if (option.element.isConnected && option.element.getAttribute('aria-selected') === 'true') {
    return true;
  }
  if (sameText(shown(control), option.label)) return true;
  const listbox = findListbox(control);
  return (
    listbox instanceof HTMLElement &&
    readOptions(listbox).some(
      (current) => current.selected && sameText(current.label, option.label),
    )
  );
}

/**
 * For widgets that show the selection outside the control (the popup closed and neither
 * the control nor a still-open option confirms it): open once more and require the option
 * with the same label to be aria-selected, then close.
 */
async function confirmByReopening(
  control: HTMLElement,
  label: string,
  timing: CustomControlTiming,
): Promise<boolean> {
  if (isExpanded(control)) return false;
  const listbox = await openListbox(control, timing);
  if (!listbox || listbox === 'ambiguous') {
    closePopup(control);
    return false;
  }
  const confirmed = readOptions(listbox).some(
    (option) => option.selected && sameText(option.label, label),
  );
  closePopup(control);
  return confirmed;
}

export function sameText(a: string, b: string): boolean {
  const left = normalizeText(a);
  return left !== '' && left === normalizeText(b);
}

function isExpanded(control: HTMLElement): boolean {
  return control.getAttribute('aria-expanded') === 'true';
}

function closeWith(control: HTMLElement, outcome: Outcome): Outcome {
  closePopup(control);
  return outcome;
}

/** Escape is the standard way to close a listbox popup without choosing anything. */
export function closePopup(control: HTMLElement) {
  control.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
}

export function arrowDown(control: HTMLElement) {
  control.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      code: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** The first half of a primary-button click, as a pointer device produces it. */
function press(element: HTMLElement) {
  dispatchPointer(element, 'pointerdown');
  dispatchPointer(element, 'mousedown');
}

/**
 * The second half of a click. The click itself is never sent to a submit button: a
 * dropdown trigger written as a plain <button> inside a form would submit the form.
 */
function release(element: HTMLElement) {
  dispatchPointer(element, 'pointerup');
  dispatchPointer(element, 'mouseup');
  if (!isSubmitter(element)) dispatchPointer(element, 'click');
}

/**
 * Buttons and links whose whole name is a navigation or submission action. Filling never
 * moves through an application or submits it, so these are never clicked, whatever their
 * type. Whole-name equality only: a dropdown showing "Next month" is not affected.
 */
const NAVIGATION_ACTIONS = new Set([
  'submit',
  'submit application',
  'apply',
  'apply now',
  'next',
  'continue',
  'save',
  'save and continue',
  'save continue',
  'save and exit',
  'save draft',
  'submit and continue',
  'continue to submit',
  'review',
  'finish',
  'back',
  'previous',
]);

export function isNavigationAction(element: HTMLElement): boolean {
  const isButtonLike =
    element.tagName === 'BUTTON' ||
    element.tagName === 'A' ||
    (element.tagName === 'INPUT' &&
      ['submit', 'button'].includes((element as HTMLInputElement).type));
  if (!isButtonLike) return false;
  const name =
    attributeText(element, 'aria-label') ??
    textOf(element) ??
    (element as HTMLInputElement).value ??
    '';
  return NAVIGATION_ACTIONS.has(normalizeText(name));
}

/** Whether clicking the element would submit a form. */
export function isSubmitter(element: HTMLElement): boolean {
  if (element.tagName === 'BUTTON') {
    const button = element as HTMLButtonElement;
    return button.type === 'submit' && button.form !== null;
  }
  if (element.tagName === 'INPUT') {
    const type = (element as HTMLInputElement).type;
    return type === 'submit' || type === 'image';
  }
  return false;
}

/** A full primary-button click, as a pointer device produces it. */
export function clickSequence(element: HTMLElement) {
  press(element);
  release(element);
}

function dispatchPointer(element: HTMLElement, type: string) {
  const init = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1 };
  const event =
    type.startsWith('pointer') && typeof PointerEvent === 'function'
      ? new PointerEvent(type, { ...init, pointerType: 'mouse', isPrimary: true })
      : new MouseEvent(type, init);
  element.dispatchEvent(event);
}

/** Polls `probe` until it returns something truthy, or the timeout passes. */
export async function waitUntil<T>(
  probe: () => T | undefined,
  { timeoutMs, intervalMs }: CustomControlTiming,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = probe();
    if (result) return result;
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
