import type { FillInstruction, FillResult, FormAdapter } from '@applyonce/core';
import {
  DEFAULT_CUSTOM_CONTROL_TIMING,
  fillFields,
  type CustomControlTiming,
  type CustomFiller,
} from '@applyonce/adapter-generic';
import { detectWorkday } from './detect';
import { scanWorkday, scanWorkdayFields } from './scan';
import { DEFAULT_SEARCH_TIMING, fillSearchInput } from './search-input';

export interface WorkdayFillOptions {
  customControlTiming?: CustomControlTiming;
  searchTiming?: CustomControlTiming;
}

/**
 * Fills a Workday step with the generic engine, rediscovering fields with the Workday scan
 * and handling search-as-you-type fields with the Workday search filler.
 */
export function fillWorkday(
  root: ParentNode,
  instructions: readonly FillInstruction[],
  {
    customControlTiming = DEFAULT_CUSTOM_CONTROL_TIMING,
    searchTiming = DEFAULT_SEARCH_TIMING,
  }: WorkdayFillOptions = {},
): Promise<FillResult[]> {
  const fillCustom: CustomFiller = ({ field, control }, value) =>
    field.custom?.pattern === 'search-input'
      ? fillSearchInput(control, value, searchTiming)
      : undefined;
  return fillFields(root, instructions, { scan: scanWorkday, customControlTiming, fillCustom });
}

/**
 * Workday integration (spec §17). Only detection, field identification, and search fields
 * are Workday-specific; mapping, approval, and filling of inputs, selects, and custom
 * dropdowns are the generic engine, run on the same Workday scan used for analysis.
 *
 * It works on the current step only: it never navigates, never clicks Next, Save and
 * Continue, or Submit, never uploads files, and never signs in.
 */
export const workdayAdapter: FormAdapter<ParentNode> = {
  id: 'workday',

  detect: (context) => detectWorkday(context).platform === 'workday',

  getFields: ({ root }) => scanWorkdayFields(root),

  fillFields: ({ root }, instructions) => fillWorkday(root, instructions),
};
