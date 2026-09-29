import { isVisible } from './visibility';

/**
 * Platform-neutral helpers for site adapters' detection and scanning. Site-specific hosts,
 * selectors, and rules stay in each adapter; only the mechanics live here.
 */

/**
 * The page's hostname, normalized: lowercase (URL parsing already lowercases) and without a
 * trailing dot ("jobs.example.com." is the same host). Never includes the port. Undefined
 * for URLs that cannot be parsed or have no host.
 */
export function pageHostname(url: string): string | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  hostname = hostname.replace(/\.$/, '');
  return hostname === '' ? undefined : hostname;
}

/** Exactly one of these hostnames (e.g. "boards.greenhouse.io"). */
export function isOneOfHosts(hostname: string | undefined, hosts: readonly string[]): boolean {
  return hostname !== undefined && hosts.includes(hostname);
}

/**
 * A proper subdomain of one of these domains: "acme.wd5.myworkdayjobs.com" is a subdomain of
 * "myworkdayjobs.com"; "evilmyworkdayjobs.com" and "myworkdayjobs.com.example.org" are not.
 */
export function isSubdomainOf(hostname: string | undefined, domains: readonly string[]): boolean {
  return hostname !== undefined && domains.some((domain) => hostname.endsWith(`.${domain}`));
}

/**
 * Rendered elements matching a selector. Platform markup that is hidden (the `hidden`
 * attribute, display: none, visibility: hidden) is never evidence and never a scan scope.
 */
export function visibleElements(root: ParentNode, selector: string): Element[] {
  return [...root.querySelectorAll(selector)].filter(isVisible);
}

/**
 * Thrown by a site adapter's scan when the page cannot be read safely with that adapter's
 * rules (e.g. two application containers where there should be one). The page is then
 * reported as unsupported; it is never handed to another adapter after being partly read.
 */
export class PlatformScanError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'PlatformScanError';
  }
}

/**
 * The single rendered container to scan: undefined when there is none (the adapter then
 * scans the page), a PlatformScanError when there are several.
 */
export function singleScope(root: ParentNode, selector: string): Element | undefined {
  const found = visibleElements(root, selector);
  if (found.length > 1) throw new PlatformScanError('several application containers');
  return found[0];
}
