import type { FillValue } from '@applyonce/core';
import { compactText, normalizeText } from '@applyonce/field-mapper';

/**
 * Deterministic option matching, in order of strictness: exact option value, normalized
 * option value, normalized option label, then value or label ignoring spaces and
 * punctuation (so "onsite" matches "On-site" and "fulltime" matches "Full time"). Each
 * stage is whole-text equality, never "contains": "Remote / Hybrid" does not match
 * "remote". The first stage with exactly one match wins; several matches in a stage is
 * ambiguous. No match means nothing is selected.
 *
 * Spoofing guard (Phase 17): the winner must also be the only option any other stage
 * matches. An option whose value says one thing and another option whose visible text
 * says the same thing (value "Canada" shown as "India", next to an option shown as
 * "Canada") make the choice ambiguous, so nothing is selected.
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
  for (const [index, stage] of stages.entries()) {
    const matches = options.filter(stage);
    if (matches.length > 1) return 'ambiguous';
    const [winner] = matches;
    if (winner === undefined) continue;
    const conflicting = stages
      .slice(index + 1)
      .some((later) => options.some((option) => option !== winner && later(option)));
    return conflicting ? 'ambiguous' : winner;
  }
  return undefined;
}

function candidateTexts(value: FillValue): string[] {
  if (value === true) return ['yes', 'true'];
  if (value === false) return ['no', 'false'];
  return [String(value)];
}
