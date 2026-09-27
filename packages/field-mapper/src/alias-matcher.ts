import {
  CONFIDENCE_THRESHOLDS,
  PROFILE_FIELDS,
  toConfidenceLevel,
  type MatchReason,
  type ProfileFieldKey,
} from '@applyonce/core';
import { AUTOCOMPLETE_TOKENS, DEFAULT_ALIASES, WEAK_ALIASES } from './aliases';
import type { FieldSignature } from './field-signature';
import type { FieldMatch, FieldMatcher } from './matcher';
import { compactText, normalizeText } from './normalize';

/**
 * Signal weights, summed and capped at 100 (spec §19). Provisional: tune against real
 * forms. With the thresholds in core (high ≥ 90, review ≥ 70, confirm ≥ 40):
 *
 * - exact label or autocomplete + compatible type → high (a clear exact match)
 * - name/id alone, placeholder, label containment, weak alias, nearby text → review at most
 * - name/id + placeholder, or label + name → high
 */
export const SIGNAL_WEIGHTS = {
  autocomplete: 80,
  label: 80,
  identifier: 40,
  placeholder: 40,
  labelContains: 40,
  weakLabel: 40,
  nearbyText: 30,
  fieldType: 10,
} as const;

/**
 * A runner-up candidate (a different profile field) scoring at least this much means the
 * metadata points in two directions, so the best match is capped below "high".
 */
export const CONFLICT_MIN_SCORE = 50;

interface AliasSet {
  /** Whitespace-free forms, for exact comparison ("firstName" = "first name"). */
  compact: ReadonlySet<string>;
  /** Normalized multi-word phrases, for containment in longer labels. */
  phrases: readonly string[];
  /** Ambiguous words (see WEAK_ALIASES), compared exactly against labels only. */
  weak: ReadonlySet<string>;
}

/**
 * Deterministic matcher over aliases and HTML autocomplete tokens. Every point of the
 * score comes with a reason, so each result can be explained.
 */
export function createAliasMatcher(
  aliases: Readonly<Partial<Record<ProfileFieldKey, readonly string[]>>> = DEFAULT_ALIASES,
  weakAliases: Readonly<Partial<Record<ProfileFieldKey, readonly string[]>>> = WEAK_ALIASES,
): FieldMatcher {
  const aliasSets = new Map<ProfileFieldKey, AliasSet>();
  const keys = new Set([
    ...Object.keys(aliases),
    ...Object.keys(weakAliases),
  ]) as Set<ProfileFieldKey>;
  for (const key of keys) {
    const phrases = aliases[key] ?? [];
    aliasSets.set(key, {
      compact: new Set(phrases.map(compactText)),
      phrases: phrases.map(normalizeText).filter((phrase) => phrase.includes(' ')),
      weak: new Set((weakAliases[key] ?? []).map(compactText)),
    });
  }

  return {
    match(signature) {
      const candidates = [...aliasSets]
        .map(([profileField, aliasSet]) => scoreCandidate(signature, profileField, aliasSet))
        .filter((candidate) => candidate !== undefined)
        .sort((a, b) => b.confidence.score - a.confidence.score);

      const [best, runnerUp] = candidates;
      if (!best) return undefined;
      if (!runnerUp || runnerUp.confidence.score < CONFLICT_MIN_SCORE) return best;

      const score = Math.min(best.confidence.score, CONFIDENCE_THRESHOLDS.high - 1);
      return {
        profileField: best.profileField,
        confidence: {
          score,
          level: toConfidenceLevel(score),
          reasons: [...best.confidence.reasons, 'conflict'],
        },
      };
    },
  };
}

function scoreCandidate(
  signature: FieldSignature,
  profileField: ProfileFieldKey,
  aliasSet: AliasSet,
): FieldMatch | undefined {
  const equals = (text: string | undefined) =>
    text !== undefined && aliasSet.compact.has(compactText(text));
  const weakEquals = (text: string | undefined) =>
    text !== undefined && aliasSet.weak.has(compactText(text));
  const contains = (text: string | undefined) =>
    text !== undefined && aliasSet.phrases.some((phrase) => ` ${text} `.includes(` ${phrase} `));

  const reasons: MatchReason[] = [];
  let score = 0;
  const add = (weight: number, ...matched: (MatchReason | false)[]) => {
    const hits = matched.filter((reason): reason is MatchReason => reason !== false);
    if (hits.length === 0) return false;
    score += weight;
    reasons.push(...hits);
    return true;
  };

  if (signature.autocomplete && AUTOCOMPLETE_TOKENS[signature.autocomplete] === profileField) {
    add(SIGNAL_WEIGHTS.autocomplete, 'autocomplete');
  }
  add(
    SIGNAL_WEIGHTS.identifier,
    (equals(signature.name) || equals(signature.nameTail)) && 'name',
    (equals(signature.htmlId) || equals(signature.idTail)) && 'html-id',
  );
  const exactLabel = add(
    SIGNAL_WEIGHTS.label,
    equals(signature.label) && 'label',
    equals(signature.ariaLabel) && 'aria-label',
  );
  const weakLabel =
    !exactLabel &&
    add(
      SIGNAL_WEIGHTS.weakLabel,
      (weakEquals(signature.label) || weakEquals(signature.ariaLabel)) && 'weak-alias',
    );
  if (!exactLabel && !weakLabel) {
    add(
      SIGNAL_WEIGHTS.labelContains,
      (contains(signature.label) || contains(signature.ariaLabel)) && 'label-contains',
    );
  }
  add(SIGNAL_WEIGHTS.placeholder, equals(signature.placeholder) && 'placeholder');
  add(SIGNAL_WEIGHTS.nearbyText, equals(signature.nearbyText) && 'nearby-text');

  if (score === 0) return undefined;

  // Field type only corroborates a text match; it never creates a match on its own.
  if (PROFILE_FIELDS[profileField].fieldTypes.includes(signature.fieldType)) {
    add(SIGNAL_WEIGHTS.fieldType, 'field-type');
  }

  score = Math.min(score, 100);
  return {
    profileField,
    confidence: { score, level: toConfidenceLevel(score), reasons },
  };
}
