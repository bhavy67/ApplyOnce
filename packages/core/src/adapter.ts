import type { FillInstruction, FillResult } from './fill';
import type { FormField } from './form-field';

/**
 * What an adapter sees. `TRoot` is left generic so this package stays free of DOM types;
 * browser adapters use a DOM node such as `ParentNode`.
 */
export interface AdapterContext<TRoot> {
  url: string;
  root: TRoot;
}

/**
 * How strongly a page shows one platform, strongest last:
 *
 * - none: no evidence.
 * - weak: something another site could share (a class name, one attribute kind, a partial
 *   structure). Never selects an adapter on its own.
 * - structure: the platform's own page structure, rendered on the page.
 * - host: one of the platform's own hostnames.
 */
export type DetectionStrength = 'none' | 'weak' | 'structure' | 'host';

export interface PlatformDetection {
  strength: DetectionStrength;
  /** Human-readable reasons, for diagnostics and tests. Never page content or values. */
  evidence: readonly string[];
}

export const NO_DETECTION: PlatformDetection = { strength: 'none', evidence: [] };

/**
 * Site integration layer (spec §16–18). Every adapter follows the same lifecycle:
 * detect → getFields (Analyze) → fillFields (Fill, which scans again first). The generic
 * adapter is the fallback when no site adapter has strong evidence.
 */
export interface FormAdapter<TRoot = unknown> {
  readonly id: string;

  /**
   * How strongly the page shows this adapter's platform. Must be cheap, deterministic, and
   * side-effect free. The fallback adapter is never chosen by detection.
   */
  detect(context: AdapterContext<TRoot>): PlatformDetection;

  /**
   * Fields on the current page or step only. Multi-step portals must not assume the
   * whole application exists in one DOM tree (spec §5). Throws when the page cannot be
   * read safely by this adapter (reported to the user as an unsupported page; never
   * retried with another adapter).
   */
  getFields(context: AdapterContext<TRoot>): FormField[];

  /**
   * Fills approved fields on the current page, one at a time, and resolves to one result
   * per instruction, in order. Must re-locate each field (the page may have re-rendered
   * since analysis), never reject because of a single field, and never submit the form.
   */
  fillFields(
    context: AdapterContext<TRoot>,
    instructions: readonly FillInstruction[],
  ): Promise<FillResult[]>;
}

export interface PlatformResolution<TRoot> {
  adapter: FormAdapter<TRoot>;
  /**
   * - host / structure: the one site adapter with the strongest evidence.
   * - conflict: several site adapters had equally strong evidence, so none was trusted.
   * - no-evidence: no site adapter had host or structure evidence.
   */
  reason: 'host' | 'structure' | 'conflict' | 'no-evidence';
  /** Every site adapter's detection, in the order given. */
  detections: readonly { id: string; detection: PlatformDetection }[];
}

const RANK: Readonly<Record<DetectionStrength, number>> = {
  none: 0,
  weak: 1,
  structure: 2,
  host: 3,
};

/**
 * Deterministic platform resolution. Precedence:
 *
 * 1. Only host and structure evidence count; weak evidence never selects an adapter.
 * 2. The strongest evidence wins: a platform's own host beats another platform's page
 *    structure.
 * 3. A tie at the strongest level is a conflict: the fallback (generic) adapter is used,
 *    never an arbitrary winner.
 * 4. No qualifying evidence: the fallback.
 *
 * A detector that throws counts as no evidence. The order of `siteAdapters` never decides
 * the result.
 */
export function resolvePlatform<TRoot>(
  siteAdapters: readonly FormAdapter<TRoot>[],
  fallback: FormAdapter<TRoot>,
  context: AdapterContext<TRoot>,
): PlatformResolution<TRoot> {
  const detections = siteAdapters.map((adapter) => {
    let detection = NO_DETECTION;
    try {
      detection = adapter.detect(context);
    } catch {
      // Detection is best effort: a failing detector never takes over a page.
    }
    return { adapter, id: adapter.id, detection };
  });
  const view = detections.map(({ id, detection }) => ({ id, detection }));
  const best = Math.max(0, ...detections.map((d) => RANK[d.detection.strength] ?? 0));
  if (best < RANK.structure) return { adapter: fallback, reason: 'no-evidence', detections: view };
  const winners = detections.filter((d) => RANK[d.detection.strength] === best);
  const [winner] = winners;
  if (winners.length !== 1 || !winner) {
    return { adapter: fallback, reason: 'conflict', detections: view };
  }
  return {
    adapter: winner.adapter,
    reason: best === RANK.host ? 'host' : 'structure',
    detections: view,
  };
}
