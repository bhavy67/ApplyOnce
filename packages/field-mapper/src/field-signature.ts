import type { FieldType, FormField } from '@applyonce/core';
import { normalizeText } from './normalize';

/**
 * Normalized view of a form field's signals: the input to matching, and the basis for
 * recognizing the same field again when the user teaches a mapping (spec §20).
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

export function createFieldSignature(field: FormField): FieldSignature {
  const { signals } = field;
  return {
    fieldType: field.type,
    name: normalizeOptional(signals.name),
    htmlId: normalizeOptional(signals.htmlId),
    nameTail: identifierTail(signals.name),
    idTail: identifierTail(signals.htmlId),
    label: normalizeOptional(signals.label),
    ariaLabel: normalizeOptional(signals.ariaLabel),
    placeholder: normalizeOptional(signals.placeholder),
    nearbyText: normalizeOptional(signals.nearbyText),
    autocomplete: signals.autocomplete?.trim().toLowerCase().split(/\s+/).at(-1) || undefined,
  };
}

/**
 * Stable key for a field, for storing user-taught mappings.
 * TODO(phase-6): validate which signals are stable across real Workday/Greenhouse visits.
 */
export function toSignatureKey(signature: FieldSignature): string {
  const text = signature.label ?? signature.ariaLabel ?? signature.placeholder ?? '';
  const identifier = signature.name ?? signature.htmlId ?? '';
  return [signature.fieldType, text, identifier].join('|');
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return normalizeText(value) || undefined;
}

/** Only set when the identifier is structured (has [ ] . : or / separators). */
function identifierTail(value: string | undefined): string | undefined {
  const segments = value?.split(/[[\].:/]+/).filter(Boolean) ?? [];
  if (segments.length < 2) return undefined;
  return normalizeOptional(segments.at(-1));
}
