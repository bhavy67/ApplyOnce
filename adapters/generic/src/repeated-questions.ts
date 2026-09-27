import { createMappingKeyParts } from '@applyonce/field-mapper';
import type { ScannedField } from './scan-fields';

/**
 * Marks a question asked more than once without record context as repeated
 * (`field.repeatedCount`), so it is never mapped, taught, or filled: ApplyOnce cannot tell
 * which profile record each copy belongs to, and page position alone is not evidence.
 *
 * - Identity is the normalized question used for Teach Once keys (label, else aria-label,
 *   placeholder, or nearby text; required markers, case, spacing, and punctuation ignored;
 *   a fieldset legend as context), or the name/id when a field has no question. The control
 *   type is not part of it: the same question asked twice is ambiguous whatever the widget.
 * - Scope is the enclosing form; fields outside any form share one scope. The same question
 *   in two separate forms is two independent questions.
 * - Only visible fields count, so a hidden template copy does not make a visible field
 *   ambiguous.
 * - Fields in a recognized repeated record section (`field.record`) are excluded: their
 *   record context decides, even though their questions repeat by design.
 */
export function markRepeatedQuestions(scanned: ScannedField[]): ScannedField[] {
  const scopes = new Map<Element | null, number>();
  const groups = new Map<string, ScannedField[]>();
  for (const entry of scanned) {
    const { field } = entry;
    if (field.record || !field.visible) continue;
    const parts = createMappingKeyParts(field);
    if (!parts) continue;
    const form = entry.controls[0]?.closest('form') ?? null;
    if (!scopes.has(form)) scopes.set(form, scopes.size);
    const key = [scopes.get(form), parts.question, parts.context, parts.identifier].join('|');
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const { field } of group) field.repeatedCount = group.length;
  }
  return scanned;
}
