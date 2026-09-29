/**
 * A safety net while ApplyOnce fills a page. The fill engines never click submit or
 * navigation controls; this catches what a page's own scripts might do in response to a
 * fill (e.g. a widget that submits its form when an option is chosen):
 *
 * - any form submission is cancelled (submit events, including requestSubmit and implicit
 *   submission, are stopped before the page's handlers run);
 * - a script-generated click on a link that would leave the document (another URL, a new
 *   tab, or a download) is cancelled. In-page links ("#…") and javascript: links, which
 *   widgets use as buttons, are left alone, and real user clicks are never touched.
 *
 * The guard is installed only for the duration of one fill call. `form.submit()` and
 * `location` assignments by page scripts fire no event and cannot be intercepted; see the
 * README (Submission safety).
 */
export interface PageGuard {
  /** Whether a submission or navigation was cancelled since the last reset. */
  tripped(): boolean;
  reset(): void;
  release(): void;
}

export const PAGE_ACTION_BLOCKED =
  'The page tried to submit the form or leave the page while this field was filled, so ApplyOnce stopped it. Check this field.';

export function guardPage(root: ParentNode): PageGuard {
  const document = (root as Node).ownerDocument ?? (root as Document);
  const view = document.defaultView;
  let tripped = false;
  if (!view) return { tripped: () => false, reset: () => undefined, release: () => undefined };

  const onSubmit = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    tripped = true;
  };
  const onClick = (event: Event) => {
    if (event.isTrusted) return;
    const target = event.target as Element | null;
    const link = typeof target?.closest === 'function' ? target.closest('a[href]') : null;
    if (!link || !leavesDocument(link as HTMLAnchorElement, view.location.href)) return;
    event.preventDefault();
    tripped = true;
  };
  view.addEventListener('submit', onSubmit, true);
  view.addEventListener('click', onClick, true);
  return {
    tripped: () => tripped,
    reset: () => {
      tripped = false;
    },
    release: () => {
      view.removeEventListener('submit', onSubmit, true);
      view.removeEventListener('click', onClick, true);
    },
  };
}

function leavesDocument(link: HTMLAnchorElement, current: string): boolean {
  const href = link.getAttribute('href') ?? '';
  if (href.trim().toLowerCase().startsWith('javascript:')) return false;
  if (link.hasAttribute('download')) return true;
  const target = (link.getAttribute('target') ?? '').toLowerCase();
  if (target !== '' && target !== '_self') return true;
  try {
    const destination = new URL(href, current);
    const here = new URL(current);
    destination.hash = '';
    here.hash = '';
    return destination.href !== here.href;
  } catch {
    return false;
  }
}
