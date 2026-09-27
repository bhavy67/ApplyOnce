import type { FormField, MappingKeyParts } from '@applyonce/core';
import { createFieldSignature } from './field-signature';
import { normalizeText } from './normalize';

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
 * Returns undefined when the field has none of these, so it cannot be taught. Fields in a
 * repeated record section have no key either: their record comes from their position, and
 * a key shared by every block ("Institution") would carry a mapping across records. The
 * same holds for a question repeated without record context (`repeatedCount`).
 */
export function createMappingKeyParts(
  field: FormField,
  normalizeQuestionText?: (text: string) => string,
): MappingKeyParts | undefined {
  // Repeated without record context: a key would carry one mapping to every copy.
  if (field.record || (field.repeatedCount ?? 1) > 1) return undefined;
  const signature = createFieldSignature(field, normalizeQuestionText);
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

/**
 * Keys to look a saved mapping up by: the current key first, then the key the same field
 * had before required/optional markers were removed from questions (Phase 6), so mappings
 * taught earlier on labels such as "Start date (required)" keep working.
 */
export function mappingKeyCandidates(field: FormField): string[] {
  const current = createMappingKey(field);
  if (!current) return [];
  const legacyParts = createMappingKeyParts(field, normalizeText);
  const legacy = legacyParts && mappingKeyFromParts(legacyParts);
  return legacy && legacy !== current ? [current, legacy] : [current];
}
