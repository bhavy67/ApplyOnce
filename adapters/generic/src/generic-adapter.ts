import { NO_DETECTION, type FormAdapter } from '@applyonce/core';
import { fillFields } from './fill-fields';
import { scanFields } from './scan-fields';

/**
 * Fallback adapter for ordinary HTML forms (spec §16). Used when no site adapter has strong
 * evidence (see resolvePlatform); it is never chosen by its own detection.
 */
export const genericAdapter: FormAdapter<ParentNode> = {
  id: 'generic',

  detect: () => NO_DETECTION,

  getFields: ({ root }) => scanFields(root),

  fillFields: ({ root }, instructions) => fillFields(root, instructions),
};
