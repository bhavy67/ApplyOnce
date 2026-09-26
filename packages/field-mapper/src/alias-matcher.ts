import {
  PROFILE_FIELDS,
  toConfidenceLevel,
  type MatchReason,
  type ProfileFieldKey,
} from '@applyonce/core';
import { AUTOCOMPLETE_TOKENS, DEFAULT_ALIASES } from './aliases';
import type { FieldSignature } from './field-signature';
import type { FieldMatch, FieldMatcher } from './matcher';
import { compactText } from './normalize';

/**
 * Provisional signal weights (spec §19). Scores are summed and capped at 100.
 * Tune against real-form fixtures; do not treat as final.
 */
export const SIGNAL_WEIGHTS = {
  autocomplete: 60,
  identifier: 40,
  label: 40,
  placeholder: 15,
  fieldType: 10,
} as const;

/**
 * Basic deterministic matcher: exact (whitespace-insensitive) alias comparison per
 * signal plus HTML autocomplete tokens.
 *
 * TODO(phase-2): partial/contains matching, nearby-text context, option-aware matching
 * for select/radio fields.
 */
export function createAliasMatcher(
  aliases: Readonly<Partial<Record<ProfileFieldKey, readonly string[]>>> = DEFAULT_ALIASES,
): FieldMatcher {
  const compactAliases = new Map<ProfileFieldKey, Set<string>>();
  for (const [key, phrases] of Object.entries(aliases) as [ProfileFieldKey, readonly string[]][]) {
    compactAliases.set(key, new Set(phrases.map(compactText)));
  }

  return {
    match(signature) {
      let best: FieldMatch | undefined;
      for (const [profileField, phrases] of compactAliases) {
        const candidate = scoreCandidate(signature, profileField, phrases);
        if (candidate && (!best || candidate.confidence.score > best.confidence.score)) {
          best = candidate;
        }
      }
      return best;
    },
  };
}

function scoreCandidate(
  signature: FieldSignature,
  profileField: ProfileFieldKey,
  phrases: ReadonlySet<string>,
): FieldMatch | undefined {
  const matches = (text: string | undefined) =>
    text !== undefined && phrases.has(compactText(text));
  const reasons: MatchReason[] = [];
  let score = 0;

  if (signature.autocomplete && AUTOCOMPLETE_TOKENS[signature.autocomplete] === profileField) {
    score += SIGNAL_WEIGHTS.autocomplete;
    reasons.push('autocomplete');
  }

  const identifierReasons = [
    matches(signature.name) && 'name',
    matches(signature.htmlId) && 'html-id',
  ].filter((reason): reason is MatchReason => reason !== false);
  if (identifierReasons.length > 0) {
    score += SIGNAL_WEIGHTS.identifier;
    reasons.push(...identifierReasons);
  }

  const labelReasons = [
    matches(signature.label) && 'label',
    matches(signature.ariaLabel) && 'aria-label',
  ].filter((reason): reason is MatchReason => reason !== false);
  if (labelReasons.length > 0) {
    score += SIGNAL_WEIGHTS.label;
    reasons.push(...labelReasons);
  }

  if (matches(signature.placeholder)) {
    score += SIGNAL_WEIGHTS.placeholder;
    reasons.push('placeholder');
  }

  if (score === 0) return undefined;

  // Field type only corroborates a text match; it never creates a match on its own.
  if (PROFILE_FIELDS[profileField].fieldTypes.includes(signature.fieldType)) {
    score += SIGNAL_WEIGHTS.fieldType;
    reasons.push('field-type');
  }

  score = Math.min(score, 100);
  return {
    profileField,
    confidence: { score, level: toConfidenceLevel(score), reasons },
  };
}
