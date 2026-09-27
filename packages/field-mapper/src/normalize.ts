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

/** A required/optional marker at the start or end of a question. */
const LEADING_MARKER = /^\s*\*+\s*/;
const TRAILING_MARKER =
  /\s*(?:\*+|\(\s*(?:required|optional)\s*\)|\[\s*(?:required|optional)\s*\]|[-–—|:,]\s*(?:required|optional))\s*$/i;

/**
 * Removes required/optional markers so they are not part of the question:
 * "First Name *", "First Name (required)", "First Name - required", "* First Name", and
 * "First Name [optional]" all become "First Name".
 *
 * Only marked forms are removed ("*", brackets, or a separator before the word), never a
 * bare trailing word: "Is sponsorship required?" keeps "required".
 */
export function stripRequiredMarkers(text: string): string {
  let result = text.replace(LEADING_MARKER, '');
  for (let previous = ''; previous !== result;) {
    previous = result;
    result = result.replace(TRAILING_MARKER, '');
  }
  return result;
}

/** Normalization for field questions (labels, aria-labels, placeholders, nearby text). */
export function normalizeQuestion(text: string): string {
  return normalizeText(stripRequiredMarkers(text));
}
