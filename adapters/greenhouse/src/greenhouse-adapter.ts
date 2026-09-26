import type { FormAdapter } from '@applyonce/core';

/** Dedicated Greenhouse integration (spec §18). */
export const greenhouseAdapter: FormAdapter<ParentNode> = {
  id: 'greenhouse',

  detect: ({ url }) => {
    const { hostname } = new URL(url);
    // TODO(phase-5): handle Greenhouse forms embedded in company career sites (iframes).
    return hostname === 'greenhouse.io' || hostname.endsWith('.greenhouse.io');
  },

  getFields: () => {
    // TODO(phase-5): field extraction, dropdowns, custom questions, step awareness.
    return [];
  },

  fillFields: (_context, instructions) =>
    // TODO(phase-5): Greenhouse-specific filling (custom widgets, step awareness).
    instructions.map(({ fieldId }) => ({
      fieldId,
      status: 'unsupported',
      message: 'Greenhouse filling is not available yet.',
    })),
};
