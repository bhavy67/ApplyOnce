import { normalizeQuestion, normalizeText } from '@applyonce/field-mapper';
import { ariaLabelledByText, attributeText } from './field-text';
import type { ScannedField } from './scan-fields';

/** How far up a labeled container may be, as for the other structural signals. */
const MAX_CONTAINER_DEPTH = 8;

/**
 * Ids that frameworks and component libraries generate (React useId, MUI, Angular Material,
 * Ember, Downshift, Headless UI, Radix, …), plus UUIDs and long hex: they can change on every
 * render, so they are never part of a field's identity.
 */
const GENERATED_ID_PATTERNS: readonly RegExp[] = [
  // React useId: ":r1:" (18), "«r1»" (19.0–19.1), "_r_1_" (19.2+).
  /[:«»]/,
  /^_r_[0-9a-z]+_$/i,
  /^(?:mui|mat-[a-z-]+|ember|react-select|downshift|headlessui-[a-z-]+|radix|v|cdk-[a-z-]+|rc_select|ui-id|jsx?|input|field|select)[-_]?\d+/i,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /[0-9a-f]{16,}/i,
];

export function isGeneratedId(id: string): boolean {
  return GENERATED_ID_PATTERNS.some((pattern) => pattern.test(id));
}

/**
 * Gives every field a semantic fingerprint (`field.identity`), and marks it `unique` when no
 * other field on the page has the same one. Components, all normalized, all metadata:
 *
 * - form context: the form's id, name, or action attribute (never its position);
 * - the fieldset legend and the nearest explicitly labeled container (aria-label /
 *   aria-labelledby on a group, region, or section) — never other surrounding text;
 * - the question (label, else aria-label, placeholder) and the control type;
 * - the name, the id unless it looks generated, and the autocomplete token;
 * - the platform key a site adapter provides (e.g. a Workday automation id);
 * - a recognized record section position.
 *
 * Never: DOM position or index, classes, current values, profile values, or page text other
 * than the field's own labels. If two fields end up identical, neither has a stable identity;
 * page position is never used to tell them apart.
 */
export function markFieldIdentity(
  scanned: ScannedField[],
  platformKey?: (element: HTMLElement) => string | undefined,
): ScannedField[] {
  const keys = scanned.map((entry) => `fp-${hash(components(entry, platformKey).join('\u0001'))}`);
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  scanned.forEach((entry, index) => {
    const key = keys[index] ?? '';
    entry.field.identity = { key, unique: counts.get(key) === 1 };
  });
  return scanned;
}

function components(
  { field, controls }: ScannedField,
  platformKey?: (element: HTMLElement) => string | undefined,
): string[] {
  const [control] = controls;
  const { signals, form, type, record } = field;
  const question = signals.label ?? signals.ariaLabel ?? signals.placeholder ?? '';
  const htmlId = signals.htmlId && !isGeneratedId(signals.htmlId) ? signals.htmlId : '';
  const formId = form?.id && !isGeneratedId(form.id) ? form.id : '';
  return [
    `form=${formId}|${form?.name ?? ''}|${form?.action ?? ''}`,
    `legend=${normalizeText(signals.nearbyText ?? '')}`,
    `container=${control ? containerLabel(control) : ''}`,
    `question=${normalizeQuestion(question)}`,
    `type=${type}`,
    `name=${signals.name ?? ''}`,
    `id=${htmlId}`,
    `autocomplete=${signals.autocomplete?.toLowerCase() ?? ''}`,
    `platform=${(control && platformKey?.(control)) ?? ''}`,
    `record=${record ? `${record.collection}:${record.index}` : ''}`,
  ];
}

/** The nearest explicitly labeled grouping container (not a fieldset: its legend counts). */
function containerLabel(control: HTMLElement): string {
  let node = control.parentElement;
  for (let depth = 0; node && depth < MAX_CONTAINER_DEPTH; depth += 1, node = node.parentElement) {
    if (node.tagName === 'FORM' || node.tagName === 'BODY') return '';
    const role = node.getAttribute('role');
    const isGroup =
      role === 'group' ||
      role === 'region' ||
      node.tagName === 'SECTION' ||
      node.tagName === 'ARTICLE';
    if (!isGroup || node.tagName === 'FIELDSET') continue;
    const text = ariaLabelledByText(node) ?? attributeText(node, 'aria-label');
    if (text) return normalizeText(text);
  }
  return '';
}

/** FNV-1a, two seeds → 16 hex digits. Deterministic; not a security primitive. */
function hash(text: string): string {
  const run = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return run(0x811c9dc5) + run(0x01000193);
}
