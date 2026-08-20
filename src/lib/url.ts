/**
 * Two URLs pointing at the same page should reuse the same monitored site,
 * otherwise every agent call creates a new one and burns the account's site
 * limit. Normalisation is deliberately conservative: query strings and paths
 * are significant (a screenshot of /pricing?plan=pro is not /pricing).
 */
export function normalizeUrl(input: string): string {
  const url = new URL(input.trim());
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  const normalizedPath = url.pathname === '/' ? '' : url.pathname;
  return `${url.hostname}${normalizedPath}${url.search}`;
}

export function sameTarget(a: string, b: string): boolean {
  try {
    return normalizeUrl(a) === normalizeUrl(b);
  } catch {
    return false;
  }
}

/** Human label for an auto-created site, e.g. "example.com/pricing". */
export function siteLabel(input: string): string {
  try {
    const url = new URL(input);
    const path = url.pathname === '/' ? '' : url.pathname;
    return `${url.hostname}${path}`.slice(0, 200);
  } catch {
    return input.slice(0, 200);
  }
}
