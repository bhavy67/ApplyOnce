import type { FieldType, FormField } from '@applyonce/core';
import { normalizeQuestion, normalizeText } from './normalize';

/**
 * Normalized view of a form field's signals: the input to matching and to the saved
 * mapping key (see mapping-key.ts).
 */
export interface FieldSignature {
  fieldType: FieldType;
  name?: string;
  htmlId?: string;
  /**
   * Last segment of a structured name or id, e.g. "first name" for
   * `job_application[first_name]` or `applicant.firstName`.
   */
  nameTail?: string;
  idTail?: string;
  label?: string;
  ariaLabel?: string;
  placeholder?: string;
  nearbyText?: string;
  /** Final HTML autocomplete token, e.g. "shipping email" → "email". */
  autocomplete?: string;
}

/**
 * Questions (label, aria-label, placeholder, nearby text) are normalized without
 * required/optional markers; identifiers are normalized as they are.
 */
export function createFieldSignature(
  field: FormField,
  normalizeQuestionText: (text: string) => string = normalizeQuestion,
): FieldSignature {
  const { signals } = field;
  const question = (value: string | undefined) => normalizeOptional(value, normalizeQuestionText);
  return {
    fieldType: field.type,
    name: normalizeOptional(signals.name),
    htmlId: normalizeOptional(signals.htmlId),
    nameTail: identifierTail(signals.name),
    idTail: identifierTail(signals.htmlId),
    label: question(signals.label),
    ariaLabel: question(signals.ariaLabel),
    placeholder: question(signals.placeholder),
    nearbyText: question(signals.nearbyText),
    autocomplete: signals.autocomplete?.trim().toLowerCase().split(/\s+/).at(-1) || undefined,
  };
}

function normalizeOptional(
  value: string | undefined,
  normalize: (text: string) => string = normalizeText,
): string | undefined {
  if (value === undefined) return undefined;
  return normalize(value) || undefined;
}

/** Only set when the identifier is structured (has [ ] . : or / separators). */
function identifierTail(value: string | undefined): string | undefined {
  const segments = value?.split(/[[\].:/]+/).filter(Boolean) ?? [];
  if (segments.length < 2) return undefined;
  return normalizeOptional(segments.at(-1));
}
