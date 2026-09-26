/**
 * Normalize human-facing field text (labels, placeholders, names) for comparison.
 *
 * "  First Name * " → "first name"
 * "first_name"      → "first name"
 * "E-mail Address:" → "e mail address"
 * "Résumé"          → "resume"
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Whitespace-free form used for matching, so that "first name", "first_name",
 * "firstName" and "firstname" all compare equal.
 */
export function compactText(text: string): string {
  return normalizeText(text).replaceAll(' ', '');
}
