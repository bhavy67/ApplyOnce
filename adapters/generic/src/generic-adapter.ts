import type { FormAdapter } from '@applyonce/core';

/**
 * Fallback adapter for ordinary HTML forms (spec §16). Used when no site-specific
 * adapter matches, so it accepts every page.
 */
export const genericAdapter: FormAdapter<ParentNode> = {
  id: 'generic',

  detect: () => true,

  getFields: () => {
    // TODO(phase-2): extract visible input/select/textarea elements and their signals
    // (name, id, label, aria-label, placeholder, autocomplete, nearby text, options).
    return [];
  },
};
