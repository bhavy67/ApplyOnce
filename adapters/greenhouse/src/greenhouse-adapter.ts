import type { FillInstruction, FillResult, FormAdapter } from '@applyonce/core';
import {
  fillCustomSelect,
  fillFields,
  type CustomControlTiming,
  type CustomFiller,
} from '@applyonce/adapter-generic';
import { detectGreenhouse } from './detect';
import { scanGreenhouse, scanGreenhouseFields } from './scan';
import { REACT_SELECT } from './selectors';

export interface GreenhouseFillOptions {
  customControlTiming?: CustomControlTiming;
}

/**
 * The selection a Greenhouse react-select shows ("" when none), or undefined when the
 * control is not inside react-select's structure. react-select renders the choice beside
 * its (empty) input and, on Apple devices, does not mark options aria-selected, so this is
 * the only reliable way to see an existing selection and to confirm a new one.
 */
export function reactSelectSelection(control: HTMLElement): string | undefined {
  const container = control.closest(REACT_SELECT.control);
  if (!container) return undefined;
  const shown = [
    ...container.querySelectorAll(`${REACT_SELECT.singleValue}, ${REACT_SELECT.multiValue}`),
  ];
  return shown.map((element) => element.textContent?.trim() ?? '').join(', ');
}

/**
 * react-select dropdowns go to the generic custom-select engine with the selection reader;
 * every other control uses the generic engines unchanged.
 */
const fillCustom: CustomFiller = ({ control }, value, timing) => {
  if (!control.matches(REACT_SELECT.input) || reactSelectSelection(control) === undefined) {
    return undefined;
  }
  return fillCustomSelect(control, value, timing, { selection: reactSelectSelection });
};

/** Fills approved fields with the generic engines and the Greenhouse scan. */
export function fillGreenhouse(
  root: ParentNode,
  instructions: readonly FillInstruction[],
  { customControlTiming }: GreenhouseFillOptions = {},
): Promise<FillResult[]> {
  return fillFields(root, instructions, {
    scan: scanGreenhouse,
    fillCustom,
    ...(customControlTiming ? { customControlTiming } : {}),
  });
}

/** Greenhouse job-board application forms (see README: Greenhouse). */
export const greenhouseAdapter: FormAdapter<ParentNode> = {
  id: 'greenhouse',
  detect: (context) => {
    const { strength, evidence } = detectGreenhouse(context);
    return { strength, evidence };
  },
  getFields: ({ root }) => scanGreenhouseFields(root),
  fillFields: ({ root }, instructions) => fillGreenhouse(root, instructions),
};
