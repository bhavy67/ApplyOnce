import { genericAdapter } from '@applyonce/adapter-generic';
import { greenhouseAdapter } from '@applyonce/adapter-greenhouse';
import { workdayAdapter } from '@applyonce/adapter-workday';
import { resolvePlatform, type AdapterContext, type PlatformResolution } from '@applyonce/core';

/** Site adapters, each chosen only by its own strong evidence (order never decides). */
export const SITE_ADAPTERS = [workdayAdapter, greenhouseAdapter];

/**
 * The adapter that scans and fills this page: the one site adapter with the strongest
 * evidence, else the generic adapter (see resolvePlatform for the precedence rules).
 */
export function resolvePageAdapter(
  context: AdapterContext<ParentNode>,
): PlatformResolution<ParentNode> {
  return resolvePlatform(SITE_ADAPTERS, genericAdapter, context);
}
