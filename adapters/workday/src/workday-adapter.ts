import type { FormAdapter } from '@applyonce/core';
import { fillFields } from '@applyonce/adapter-generic';
import { detectWorkday } from './detect';
import { scanWorkday, scanWorkdayFields } from './scan';

/**
 * Workday integration (spec §17). Only detection and field identification are
 * Workday-specific; mapping, approval, and filling (native inputs, selects, and custom
 * dropdowns) are the generic engine, run on the same Workday scan used for analysis.
 *
 * It works on the current step only: it never navigates, never clicks Next, Save and
 * Continue, or Submit, never uploads files, and never signs in.
 */
export const workdayAdapter: FormAdapter<ParentNode> = {
  id: 'workday',

  detect: (context) => detectWorkday(context).platform === 'workday',

  getFields: ({ root }) => scanWorkdayFields(root),

  fillFields: ({ root }, instructions) => fillFields(root, instructions, { scan: scanWorkday }),
};
