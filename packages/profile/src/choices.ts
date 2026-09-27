import { PROFILE_FIELDS, type ProfileFieldKey } from '@applyonce/core';

/**
 * Canonical value for a "choice" field, or undefined when the input is not one of its
 * choices. Case, spacing, hyphens, and underscores are ignored, and the choice label is
 * accepted too: "REMOTE", "On-site", "on site", "full_time", "Full Time" all normalize.
 * No synonyms beyond that: this is not an ontology.
 */
export function normalizeChoice(key: ProfileFieldKey, input: unknown): string | undefined {
  const choices = PROFILE_FIELDS[key].choices;
  if (!choices || typeof input !== 'string') return undefined;
  const wanted = compact(input);
  if (wanted === '') return undefined;
  return choices.find((c) => compact(c.value) === wanted || compact(c.label) === wanted)?.value;
}

function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
