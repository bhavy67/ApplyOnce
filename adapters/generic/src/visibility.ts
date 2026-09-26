/**
 * Practical visibility check for a single control: `hidden` attribute, `display: none`
 * (on the element or an ancestor), and `visibility: hidden`. No layout or geometry
 * analysis, so visually restyled controls (e.g. custom radio buttons) still count.
 */
export function isVisible(element: Element): boolean {
  if (element.closest('[hidden]')) return false;

  // Chrome's native check covers ancestors, display, and visibility in one call.
  if (typeof element.checkVisibility === 'function') {
    return element.checkVisibility({ visibilityProperty: true });
  }

  const view = element.ownerDocument.defaultView;
  if (!view) return true;
  if (view.getComputedStyle(element).visibility === 'hidden') return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (view.getComputedStyle(node).display === 'none') return false;
  }
  return true;
}
