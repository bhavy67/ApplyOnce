import type { FormAdapter } from '@applyonce/core';
import { scanFields } from './scan-fields';

/**
 * Fallback adapter for ordinary HTML forms (spec §16). Used when no site-specific
 * adapter matches, so it accepts every page.
 */
export const genericAdapter: FormAdapter<ParentNode> = {
  id: 'generic',

  detect: () => true,

  getFields: ({ root }) => scanFields(root),
};
