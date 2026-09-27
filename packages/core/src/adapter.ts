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
 * Site integration layer (spec §16–18). Each adapter evolves independently; the
 * generic adapter is the fallback when no site-specific adapter matches.
 */
export interface FormAdapter<TRoot = unknown> {
  readonly id: string;

  /** Whether this adapter handles the page. Must be cheap and side-effect free. */
  detect(context: AdapterContext<TRoot>): boolean;

  /**
   * Fields on the current page or step only. Multi-step portals must not assume the
   * whole application exists in one DOM tree (spec §5).
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

export function selectAdapter<TRoot>(
  siteAdapters: readonly FormAdapter<TRoot>[],
  fallback: FormAdapter<TRoot>,
  context: AdapterContext<TRoot>,
): FormAdapter<TRoot> {
  return siteAdapters.find((adapter) => adapter.detect(context)) ?? fallback;
}
