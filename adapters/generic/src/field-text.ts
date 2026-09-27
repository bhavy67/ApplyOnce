/** Longest text kept for any label or context string. */
const MAX_TEXT_LENGTH = 200;
/** How many ancestor levels to search for preceding text. Kept small on purpose. */
const MAX_ANCESTOR_STEPS = 3;

export const CONTROL_SELECTOR = 'input, select, textarea';

export function cleanText(text: string | null | undefined): string | undefined {
  const cleaned = text?.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
  return cleaned || undefined;
}

/**
 * Text of an element, excluding nested controls (so a wrapping label's select options are
 * not included) and decorative content hidden from assistive technology
 * (`aria-hidden="true"`, e.g. a styled required asterisk).
 */
export function textOf(element: Element): string | undefined {
  const clone = element.cloneNode(true) as Element;
  clone
    .querySelectorAll(`${CONTROL_SELECTOR}, button, script, style, [aria-hidden="true"]`)
    .forEach((node) => {
      node.remove();
    });
  return cleanText(clone.textContent);
}

/** Label elements indexed by their `for` attribute, built once per scan. */
export function collectLabelsByFor(root: ParentNode): Map<string, Element[]> {
  const labels = new Map<string, Element[]>();
  root.querySelectorAll('label[for]').forEach((label) => {
    const target = label.getAttribute('for');
    if (!target) return;
    labels.set(target, [...(labels.get(target) ?? []), label]);
  });
  return labels;
}

/** Text of the label(s) attached to a control: a wrapping <label> and/or <label for>. */
export function labelText(
  control: Element,
  labelsByFor: Map<string, Element[]>,
): string | undefined {
  const wrapping = control.closest('label');
  const forLabels = control.id ? (labelsByFor.get(control.id) ?? []) : [];
  const labels = wrapping ? [wrapping, ...forLabels.filter((l) => l !== wrapping)] : forLabels;
  return cleanText(labels.map(textOf).filter(Boolean).join(' '));
}

/** How many ancestor levels a wrapper label may be found at. */
const MAX_WRAPPER_DEPTH = 3;

/** Controls that count as "another field" inside a wrapper (hidden inputs do not). */
const FIELD_CONTROL_SELECTOR =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea';

/**
 * A `<label>` without `for` that sits next to the control in a field wrapper, as in
 * `<div class="field"><label>First name</label><div><input></div></div>`.
 *
 * Rule: walking up at most three levels (never past a form, fieldset, or body), the first
 * wrapper that contains this control and no other field, and exactly one label without a
 * `for` attribute that wraps no control, supplies the label. A wrapper containing another
 * field ends the search, so a label is never taken from a neighbouring field.
 */
export function wrapperLabelText(control: Element): string | undefined {
  let node = control.parentElement;
  for (let depth = 0; node && depth < MAX_WRAPPER_DEPTH; depth += 1) {
    if (node.matches('form, fieldset, body')) return undefined;
    if (node.querySelectorAll(FIELD_CONTROL_SELECTOR).length > 1) return undefined;
    const labels = Array.from(node.querySelectorAll('label')).filter(
      (label) => !label.hasAttribute('for') && label.querySelector(CONTROL_SELECTOR) === null,
    );
    if (labels.length > 1) return undefined;
    const [label] = labels;
    if (label) return textOf(label);
    node = node.parentElement;
  }
  return undefined;
}

export function ariaLabelledByText(element: Element): string | undefined {
  const ids = element.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean) ?? [];
  const texts = ids
    .map((id) => element.ownerDocument.getElementById(id))
    .filter((node) => node !== null)
    .map(textOf);
  return cleanText(texts.filter(Boolean).join(' '));
}

export function attributeText(element: Element, name: string): string | undefined {
  return cleanText(element.getAttribute(name));
}

/** The <legend> of the closest enclosing <fieldset>, e.g. the question of a radio group. */
export function legendText(element: Element): string | undefined {
  const fieldset = element.closest('fieldset');
  const legend = fieldset && Array.from(fieldset.children).find((c) => c.tagName === 'LEGEND');
  return legend ? textOf(legend) : undefined;
}

/**
 * Nearest text before an unlabeled control, e.g. `<p>Notes</p><textarea>` or
 * `Name: <input>`. Searches only a few ancestor levels and stops at anything belonging to
 * another field, so text is never borrowed from a neighbouring control.
 */
export function precedingText(element: Element): string | undefined {
  let node: Element | null = element;
  for (let step = 0; node && step <= MAX_ANCESTOR_STEPS; step += 1) {
    for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
      if (sibling.nodeType === sibling.TEXT_NODE) {
        const text = cleanText(sibling.textContent);
        if (text) return text;
        continue;
      }
      if (sibling.nodeType !== sibling.ELEMENT_NODE) continue;
      const siblingElement = sibling as Element;
      if (belongsToAnotherField(siblingElement)) return undefined;
      const text = textOf(siblingElement);
      if (text) return text;
    }
    node = node.parentElement;
    if (!node || node.matches('form, fieldset, body')) return undefined;
  }
  return undefined;
}

function belongsToAnotherField(element: Element): boolean {
  return (
    element.matches(CONTROL_SELECTOR) ||
    element.querySelector(CONTROL_SELECTOR) !== null ||
    (element.tagName === 'LABEL' && element.hasAttribute('for'))
  );
}
