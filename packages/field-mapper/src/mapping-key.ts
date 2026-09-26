import type { FormField, MappingKeyParts } from '@applyonce/core';
import { createFieldSignature } from './field-signature';

/** Bump when the key format changes; older saved mappings then simply stop matching. */
const KEY_VERSION = 'v1';

/**
 * The characteristics a taught mapping is remembered by (spec §20, "Teach Once").
 *
 * - The field type is always part of it: a text box and a dropdown asking the same
 *   question hold different kinds of values.
 * - The question is the field's whole normalized text: label, else aria-label, else
 *   placeholder, else nearby text. Compared by exact equality, never containment, so
 *   "preferred work location" and "current location" stay different.
 * - A fieldset legend is added as context when the question is the field's own label, so
 *   "Phone" under "Emergency contact" differs from "Phone" under "Your details", and a
 *   checkbox labeled "Yes" is tied to its question.
 * - name/id is used only when there is no question text, because names are
 *   site-specific while visible questions are what repeats across sites.
 * - No URL or hostname: a taught mapping applies wherever the same question appears.
 *
 * Returns undefined when the field has none of these, so it cannot be taught.
 */
export function createMappingKeyParts(field: FormField): MappingKeyParts | undefined {
  const signature = createFieldSignature(field);
  const ownLabel = signature.label ?? signature.ariaLabel;
  const question = ownLabel ?? signature.placeholder ?? signature.nearbyText;
  if (question) {
    const context =
      ownLabel && signature.nearbyText !== question ? signature.nearbyText : undefined;
    return { fieldType: field.type, question, ...(context ? { context } : {}) };
  }
  const identifier = signature.name ?? signature.htmlId;
  return identifier ? { fieldType: field.type, identifier } : undefined;
}

export function mappingKeyFromParts(parts: MappingKeyParts): string {
  return [
    KEY_VERSION,
    parts.fieldType,
    `q=${parts.question ?? ''}`,
    `c=${parts.context ?? ''}`,
    `i=${parts.identifier ?? ''}`,
  ].join('|');
}

export function createMappingKey(field: FormField): string | undefined {
  const parts = createMappingKeyParts(field);
  return parts && mappingKeyFromParts(parts);
}
