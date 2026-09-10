import type { FetchLike } from './client.ts';

/**
 * OAuth 2.1 support for the hosted endpoint.
 *
 * Clerk is the authorization server: it already owns the identity of every
 * Captureze user, so a verified OAuth token resolves to the same Clerk user id
 * that an API key resolves to. This module is only loaded when the Clerk
 * environment variables are present — a self-hosted install keeps working on
 * `cap_` keys and never touches any of it.
 */

/**
 * A Clerk publishable key is the base64url of the instance's frontend API host
 * with a `$` terminator, so the authorization server is derivable from it and
 * needs no second environment variable.
 */
export function deriveAuthorizationServerUrl(publishableKey: string): string {
  const encoded = publishableKey.replace(/^pk_(test|live)_/, '');
  const host = Buffer.from(encoded, 'base64url').toString('utf8').replace(/\$$/, '');
  return `https://${host}`;
}

const CLERK_VERIFY_ENDPOINT = 'https://api.clerk.com/v1/oauth_applications/access_tokens/verify';

export interface VerifiedToken {
  /** Clerk user id — the same identity an API key resolves to. */
  userId: string;
  clientId: string;
  scopes: string[];
}

export interface ClerkTokenVerifierOptions {
  secretKey: string;
  fetchImpl?: FetchLike;
  /** How long a verdict is reused. Bounds how long a revoked token still works. */
  cacheTtlMs?: number;
  /** Test seam. */
  now?: () => number;
  /** Ceiling on remembered verdicts; the oldest is dropped past it. */
  maxCacheEntries?: number;
}

/** Short enough that a revocation takes effect promptly, long enough to matter. */
const DEFAULT_CACHE_TTL_MS = 60_000;
/** A public endpoint is shown attacker-chosen tokens; the cache must not follow them. */
const DEFAULT_MAX_CACHE_ENTRIES = 10_000;

interface CacheEntry {
  verdict: VerifiedToken | null;
  expiresAt: number;
}

/** Verifies Clerk OAuth access tokens against Clerk's Backend API. */
export class ClerkTokenVerifier {
  private readonly secretKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly maxCacheEntries: number;
  /** Insertion-ordered, so the first key is always the oldest. */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: ClerkTokenVerifierOptions) {
    this.secretKey = options.secretKey;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
    this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  }

  async verify(token: string): Promise<VerifiedToken | null> {
    const cached = this.cache.get(token);
    if (cached && cached.expiresAt > this.now()) return cached.verdict;

    const verdict = await this.ask(token);
    this.cache.delete(token);
    this.cache.set(token, { verdict, expiresAt: this.now() + this.cacheTtlMs });
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return verdict;
  }

  private async ask(token: string): Promise<VerifiedToken | null> {
    const response = await this.fetchImpl(CLERK_VERIFY_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ access_token: token }),
    });

    // Clerk answers 404 for a token it has never issued. Any other failure is
    // Clerk being unwell: denying the caller for that would answer 401 and send
    // every connected client into a re-authorisation loop over our outage.
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Clerk rejected the token verification request with ${response.status}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;

    // A token Clerk recognises is not necessarily one it still honours: the
    // status code stays 200 and the reason arrives in the body. `active: false`
    // is the shape an instance issuing JWT access tokens answers with.
    if (payload.active === false) return null;
    if (payload.revoked === true || payload.expired === true) return null;
    if (typeof payload.subject !== 'string') return null;

    return {
      userId: payload.subject,
      clientId: typeof payload.client_id === 'string' ? payload.client_id : '',
      scopes: Array.isArray(payload.scopes) ? (payload.scopes as string[]) : [],
    };
  }
}

/**
 * Clerk's own defaults. Captureze-specific scopes (read vs. capture) would be a
 * later refinement; the tool surface is uniform today, so there is nothing for
 * a narrower scope to protect.
 */
const DEFAULT_SCOPES = ['openid', 'profile', 'email'];

export interface OAuthConfig {
  publishableKey: string;
  secretKey: string;
  /** Clerk, derived from the publishable key. */
  authorizationServerUrl: string;
  /**
   * This endpoint's own public origin, when pinned by configuration. Left
   * unset it is read from the request, which is safe only because
   * CAPTUREZE_MCP_ALLOWED_HOSTS already refuses a Host header we did not expect.
   */
  publicUrl?: string;
  scopes: string[];
}

/**
 * OAuth is opt-in: it turns on only when Clerk is fully configured, so a
 * self-hosted install pointed at a self-hosted Captureze keeps working on
 * `cap_` keys and never loads any of this.
 */
export function loadOAuthConfig(env: NodeJS.ProcessEnv = process.env): OAuthConfig | null {
  const publishableKey = env.CLERK_PUBLISHABLE_KEY?.trim();
  const secretKey = env.CLERK_SECRET_KEY?.trim();
  if (!publishableKey || !secretKey) return null;

  return {
    publishableKey,
    secretKey,
    authorizationServerUrl: deriveAuthorizationServerUrl(publishableKey),
    publicUrl: env.CAPTUREZE_MCP_PUBLIC_URL?.trim().replace(/\/+$/, '') || undefined,
    scopes: DEFAULT_SCOPES,
  };
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
  resource_name: string;
  resource_documentation: string;
}

/** RFC 9728 protected resource metadata — how a client finds the token issuer. */
export function protectedResourceMetadata(options: {
  resourceUrl: string;
  authorizationServerUrl: string;
  scopes?: string[];
}): ProtectedResourceMetadata {
  return {
    resource: options.resourceUrl,
    authorization_servers: [options.authorizationServerUrl],
    bearer_methods_supported: ['header'],
    scopes_supported: options.scopes ?? DEFAULT_SCOPES,
    resource_name: 'Captureze',
    resource_documentation: 'https://github.com/Captureze/mcp#readme',
  };
}

/**
 * What the HTTP layer needs from an authorization server. Keeping it an
 * interface is what lets `http.ts` carry the OAuth routes without knowing that
 * the issuer is Clerk.
 */
export interface OAuthProvider {
  readonly config: OAuthConfig;
  verify(token: string): Promise<VerifiedToken | null>;
  authorizationServerMetadata(): Promise<unknown>;
}

export class ClerkOAuthProvider implements OAuthProvider {
  readonly config: OAuthConfig;
  private readonly verifier: ClerkTokenVerifier;
  private readonly fetchImpl: FetchLike;
  private metadata?: Promise<unknown>;

  constructor(config: OAuthConfig, fetchImpl?: FetchLike) {
    this.config = config;
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
    this.verifier = new ClerkTokenVerifier({ secretKey: config.secretKey, fetchImpl: this.fetchImpl });
  }

  verify(token: string): Promise<VerifiedToken | null> {
    return this.verifier.verify(token);
  }

  /**
   * RFC 8414 metadata, mirrored from Clerk. Clients that follow the protected
   * resource metadata reach Clerk directly; this copy is for the ones that
   * still look for it on the resource server's own origin.
   */
  authorizationServerMetadata(): Promise<unknown> {
    // Cached as the promise, so a burst of first callers makes one request.
    this.metadata ??= this.fetchAuthorizationServerMetadata().catch((error: unknown) => {
      this.metadata = undefined;
      throw error;
    });
    return this.metadata;
  }

  private async fetchAuthorizationServerMetadata(): Promise<unknown> {
    const url = `${this.config.authorizationServerUrl}/.well-known/oauth-authorization-server`;
    const response = await this.fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Clerk returned ${response.status} for ${url}`);
    }
    return response.json();
  }
}
