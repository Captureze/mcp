import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClerkOAuthProvider,
  ClerkTokenVerifier,
  deriveAuthorizationServerUrl,
  loadOAuthConfig,
  protectedResourceMetadata,
} from './oauth.ts';
import type { FetchLike } from './client.ts';

describe('deriveAuthorizationServerUrl', () => {
  it('reads the Clerk frontend API host out of a production publishable key', () => {
    assert.equal(
      deriveAuthorizationServerUrl('pk_live_Y2xlcmsuY2FwdHVyZXplLmNvbSQ'),
      'https://clerk.captureze.com',
    );
  });

  it('reads it out of a development publishable key too', () => {
    assert.equal(
      deriveAuthorizationServerUrl('pk_test_bWlnaHR5LWdvcGhlci02MS5jbGVyay5hY2NvdW50cy5kZXYk'),
      'https://mighty-gopher-61.clerk.accounts.dev',
    );
  });
});

const SUBJECT = 'user_2xhFjEI5X2qWRvtV13BzSj8H6Dk';

function clerkStub(body: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}

function activeToken(overrides: Record<string, unknown> = {}) {
  return {
    object: 'clerk_idp_oauth_access_token',
    id: 'oat_0ef5a7a33d87ed87ee7954c845d80450',
    client_id: 'client_2xhFjEI5X2qWRvtV13BzSj8H6Dk',
    subject: SUBJECT,
    scopes: ['openid', 'profile', 'email'],
    revoked: false,
    revocation_reason: null,
    expired: false,
    expiration: null,
    created_at: 1716883200,
    updated_at: 1716883200,
    ...overrides,
  };
}

describe('ClerkTokenVerifier', () => {
  it('resolves an active token to the Clerk user it belongs to', async () => {
    const { fetchImpl, calls } = clerkStub(activeToken());
    const verifier = new ClerkTokenVerifier({ secretKey: 'sk_test_x', fetchImpl });

    const result = await verifier.verify('oat_live_token');

    assert.deepEqual(result, {
      userId: SUBJECT,
      clientId: 'client_2xhFjEI5X2qWRvtV13BzSj8H6Dk',
      scopes: ['openid', 'profile', 'email'],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'https://api.clerk.com/v1/oauth_applications/access_tokens/verify');
    assert.equal(calls[0]!.init?.method, 'POST');
    assert.match(
      String((calls[0]!.init?.headers as Record<string, string>).Authorization),
      /^Bearer sk_test_x$/,
    );
    assert.equal(JSON.parse(String(calls[0]!.init?.body)).access_token, 'oat_live_token');
  });

  // Clerk answers 200 for a token it recognises but will not honour, with the
  // reason in the body. Trusting the status code alone accepts revoked tokens.
  it('rejects a revoked token even though Clerk answers 200', async () => {
    const { fetchImpl } = clerkStub(activeToken({ revoked: true, revocation_reason: 'Revoked by user' }));
    const verifier = new ClerkTokenVerifier({ secretKey: 'sk_test_x', fetchImpl });
    assert.equal(await verifier.verify('oat_revoked'), null);
  });

  it('rejects an expired token even though Clerk answers 200', async () => {
    const { fetchImpl } = clerkStub(activeToken({ expired: true, expiration: 1716883200 }));
    const verifier = new ClerkTokenVerifier({ secretKey: 'sk_test_x', fetchImpl });
    assert.equal(await verifier.verify('oat_expired'), null);
  });

  // The other half of the endpoint's `anyOf`: an instance issuing JWT access
  // tokens answers with this shape instead of a token record.
  it('rejects the inactive-JWT answer shape', async () => {
    const { fetchImpl } = clerkStub({ active: false });
    const verifier = new ClerkTokenVerifier({ secretKey: 'sk_test_x', fetchImpl });
    assert.equal(await verifier.verify('oat_jwt'), null);
  });

  it('rejects a token Clerk has never heard of', async () => {
    const { fetchImpl } = clerkStub(
      { errors: [{ message: 'not found', long_message: 'not found', code: 'oauth_access_token_not_found' }] },
      404,
    );
    const verifier = new ClerkTokenVerifier({ secretKey: 'sk_test_x', fetchImpl });
    assert.equal(await verifier.verify('oat_bogus'), null);
  });

  // A Clerk outage is not the caller's fault. Returning null would answer 401
  // and send every connected client into a pointless re-authorisation loop.
  it('throws rather than denying the caller when Clerk itself fails', async () => {
    const { fetchImpl } = clerkStub({ errors: [{ code: 'internal_error' }] }, 500);
    const verifier = new ClerkTokenVerifier({ secretKey: 'sk_test_x', fetchImpl });
    await assert.rejects(() => verifier.verify('oat_any'), /Clerk/);
  });

  // Every MCP call is one HTTP request, and each one would otherwise cost a
  // round-trip to Clerk before any work starts.
  it('asks Clerk once for a token it has already seen', async () => {
    const { fetchImpl, calls } = clerkStub(activeToken());
    const verifier = new ClerkTokenVerifier({ secretKey: 'sk_test_x', fetchImpl });

    await verifier.verify('oat_same');
    const second = await verifier.verify('oat_same');

    assert.equal(calls.length, 1);
    assert.equal(second?.userId, SUBJECT);
  });

  it('asks again once the cached answer has aged out', async () => {
    const { fetchImpl, calls } = clerkStub(activeToken());
    let clock = 0;
    const verifier = new ClerkTokenVerifier({
      secretKey: 'sk_test_x',
      fetchImpl,
      cacheTtlMs: 60_000,
      now: () => clock,
    });

    await verifier.verify('oat_same');
    clock = 60_001;
    await verifier.verify('oat_same');

    assert.equal(calls.length, 2);
  });

  // Tokens are valid from the moment they are issued, so "no" never becomes
  // "yes" for the same string — caching the refusal costs nothing and keeps a
  // flood of junk tokens from being amplified into calls on Clerk.
  it('remembers a refusal too', async () => {
    const { fetchImpl, calls } = clerkStub({ errors: [{ code: 'oauth_access_token_not_found' }] }, 404);
    const verifier = new ClerkTokenVerifier({ secretKey: 'sk_test_x', fetchImpl });

    assert.equal(await verifier.verify('oat_bogus'), null);
    assert.equal(await verifier.verify('oat_bogus'), null);
    assert.equal(calls.length, 1);
  });

  // The endpoint is public, so the set of tokens it is shown is attacker-chosen.
  // An unbounded map of verdicts is an unbounded memory leak with a stranger
  // holding the pen.
  it('does not keep every token it has ever been shown', async () => {
    const { fetchImpl, calls } = clerkStub(activeToken());
    const verifier = new ClerkTokenVerifier({ secretKey: 'sk_test_x', fetchImpl, maxCacheEntries: 2 });

    await verifier.verify('oat_a');
    await verifier.verify('oat_b');
    await verifier.verify('oat_c');
    await verifier.verify('oat_a');

    assert.equal(calls.length, 4, 'the oldest verdict should have been dropped');
  });
});

describe('loadOAuthConfig', () => {
  // Self-hosted installs must be able to ignore all of this. Absent Clerk
  // variables mean the endpoint stays exactly what it is today.
  it('stays off when Clerk is not configured', () => {
    assert.equal(loadOAuthConfig({} as NodeJS.ProcessEnv), null);
  });

  it('stays off when only half of Clerk is configured', () => {
    assert.equal(
      loadOAuthConfig({ CLERK_SECRET_KEY: 'sk_live_x' } as NodeJS.ProcessEnv),
      null,
      'a secret key without a publishable key cannot name an authorization server',
    );
    assert.equal(
      loadOAuthConfig({ CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuY2FwdHVyZXplLmNvbSQ' } as NodeJS.ProcessEnv),
      null,
      'a publishable key without a secret key cannot verify anything',
    );
  });

  it('derives the authorization server from the publishable key', () => {
    const config = loadOAuthConfig({
      CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuY2FwdHVyZXplLmNvbSQ',
      CLERK_SECRET_KEY: 'sk_live_x',
      CAPTUREZE_MCP_PUBLIC_URL: 'https://mcp.captureze.com',
    } as NodeJS.ProcessEnv);

    assert.equal(config?.authorizationServerUrl, 'https://clerk.captureze.com');
    assert.equal(config?.secretKey, 'sk_live_x');
    assert.equal(config?.publicUrl, 'https://mcp.captureze.com');
  });
});

describe('protectedResourceMetadata', () => {
  it('names this endpoint as the resource and Clerk as its authorization server', () => {
    const metadata = protectedResourceMetadata({
      resourceUrl: 'https://mcp.captureze.com/mcp',
      authorizationServerUrl: 'https://clerk.captureze.com',
    });

    assert.equal(metadata.resource, 'https://mcp.captureze.com/mcp');
    assert.deepEqual(metadata.authorization_servers, ['https://clerk.captureze.com']);
    // The token arrives in the Authorization header and nowhere else.
    assert.deepEqual(metadata.bearer_methods_supported, ['header']);
    assert.deepEqual(metadata.scopes_supported, ['openid', 'profile', 'email']);
  });
});

describe('ClerkOAuthProvider', () => {
  const CONFIG = loadOAuthConfig({
    CLERK_PUBLISHABLE_KEY: 'pk_live_Y2xlcmsuY2FwdHVyZXplLmNvbSQ',
    CLERK_SECRET_KEY: 'sk_live_x',
  } as NodeJS.ProcessEnv)!;

  it('serves Clerk’s authorization server metadata as our own', async () => {
    const { fetchImpl, calls } = clerkStub({ issuer: 'https://clerk.captureze.com' });
    const provider = new ClerkOAuthProvider(CONFIG, fetchImpl);

    const metadata = await provider.authorizationServerMetadata();

    assert.equal((metadata as { issuer: string }).issuer, 'https://clerk.captureze.com');
    assert.equal(calls[0]!.url, 'https://clerk.captureze.com/.well-known/oauth-authorization-server');
  });

  // The document changes about never; fetching it per request would put Clerk
  // on the critical path of every client's discovery.
  it('does not re-fetch that document for every caller', async () => {
    const { fetchImpl, calls } = clerkStub({ issuer: 'https://clerk.captureze.com' });
    const provider = new ClerkOAuthProvider(CONFIG, fetchImpl);

    await provider.authorizationServerMetadata();
    await provider.authorizationServerMetadata();

    assert.equal(calls.length, 1);
  });
});
