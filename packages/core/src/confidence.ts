/** Why a mapping was chosen. Keeps the mapper explainable (spec §14, §26). */
export type MatchReason =
  | 'autocomplete'
  | 'name'
  | 'html-id'
  | 'label'
  | 'aria-label'
  /** A multi-word alias appears inside a longer label, e.g. "Legal first name (as on ID)". */
  | 'label-contains'
  /** The label is an ambiguous word such as "Company"; never enough for high confidence. */
  | 'weak-alias'
  | 'placeholder'
  | 'field-type'
  | 'nearby-text'
  | 'site-rule'
  | 'user-mapping'
  /** Another profile field also matched strongly, so confidence was lowered. */
  | 'conflict';

export type ConfidenceLevel = 'high' | 'review' | 'confirm' | 'unknown';

export interface ConfidenceResult {
  /** 0–100. */
  score: number;
  level: ConfidenceLevel;
  reasons: readonly MatchReason[];
}

/**
 * Provisional thresholds from spec §19. Not final: tune them against real forms.
 *
 * 90–100 high · 70–89 review recommended · 40–69 manual confirmation · 0–39 unknown
 */
export const CONFIDENCE_THRESHOLDS = {
  high: 90,
  review: 70,
  confirm: 40,
} as const;

export function toConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_THRESHOLDS.high) return 'high';
  if (score >= CONFIDENCE_THRESHOLDS.review) return 'review';
  if (score >= CONFIDENCE_THRESHOLDS.confirm) return 'confirm';
  return 'unknown';
}
