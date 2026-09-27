import type { FillStatus } from '@applyonce/core';

/** A fill result without the field id. Messages never contain the value. */
export type Outcome = { status: FillStatus; message: string };

export const ALREADY_MATCHES = 'The field already matches your profile.';
export const EXISTING_VALUE = 'The field already has a value.';

export const filled = (): Outcome => ({ status: 'filled', message: 'Filled.' });
export const skipped = (message: string): Outcome => ({ status: 'skipped', message });
export const failed = (message: string): Outcome => ({ status: 'failed', message });
export const unsupported = (message: string): Outcome => ({ status: 'unsupported', message });
