import type { FillValue } from '@applyonce/core';
import { compactText, normalizeText } from '@applyonce/field-mapper';

/**
 * Deterministic option matching, in order of strictness: exact option value, normalized
 * option value, normalized option label, then value or label ignoring spaces and
 * punctuation (so "onsite" matches "On-site" and "fulltime" matches "Full time"). Each
 * stage is whole-text equality, never "contains": "Remote / Hybrid" does not match
 * "remote". The first stage with exactly one match wins; several matches in a stage is
 * ambiguous. No match means nothing is selected.
 */
export function findMatchingOption<T>(
  options: readonly T[],
  describe: (option: T) => { value: string; label: string },
  value: FillValue,
): T | 'ambiguous' | undefined {
  const candidates = candidateTexts(value);
  const normalized = candidates.map(normalizeText).filter(Boolean);
  const compacted = candidates.map(compactText).filter(Boolean);
  const stages: ((option: T) => boolean)[] = [
    (option) => candidates.includes(describe(option).value),
    (option) => normalized.includes(normalizeText(describe(option).value)),
    (option) => normalized.includes(normalizeText(describe(option).label)),
    (option) =>
      compacted.includes(compactText(describe(option).value)) ||
      compacted.includes(compactText(describe(option).label)),
  ];
  for (const stage of stages) {
    const matches = options.filter(stage);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return 'ambiguous';
  }
  return undefined;
}

function candidateTexts(value: FillValue): string[] {
  if (value === true) return ['yes', 'true'];
  if (value === false) return ['no', 'false'];
  return [String(value)];
}
