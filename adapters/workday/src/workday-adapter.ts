import type { FormAdapter } from '@applyonce/core';

const WORKDAY_HOST_SUFFIXES = ['.myworkdayjobs.com', '.myworkdaysite.com'];

/** Dedicated Workday integration (spec §17). */
export const workdayAdapter: FormAdapter<ParentNode> = {
  id: 'workday',

  detect: ({ url }) => {
    const { hostname } = new URL(url);
    // TODO(phase-4): confirm against real application URLs, including custom domains.
    return WORKDAY_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  },

  getFields: () => {
    // TODO(phase-4): step detection and field extraction. Never assume every Workday
    // page is identical; handle conditional sections and custom widgets.
    return [];
  },
};
