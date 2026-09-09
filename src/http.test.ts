import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createHttpApp, type HttpOptions } from './http.ts';
import { loadConfig } from './lib/config.ts';
import type { FetchLike } from './lib/client.ts';
import type { OAuthConfig, OAuthProvider, VerifiedToken } from './lib/oauth.ts';

const CONFIG = loadConfig({ CAPTUREZE_BASE_URL: 'https://captureze.com' } as NodeJS.ProcessEnv);

async function withServer(options: Partial<HttpOptions>, run: (base: string) => Promise<void>) {
  const app = createHttpApp({ config: CONFIG, port: 0, host: '127.0.0.1', ...options });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

const OAUTH_CONFIG: OAuthConfig = {
  publishableKey: 'pk_live_Y2xlcmsuY2FwdHVyZXplLmNvbSQ',
  secretKey: 'sk_live_x',
  authorizationServerUrl: 'https://clerk.captureze.com',
  publicUrl: 'https://mcp.captureze.com',
  scopes: ['openid', 'profile', 'email'],
};

function fakeOAuth(tokens: Record<string, VerifiedToken> = {}) {
  const verified: string[] = [];
  const provider: OAuthProvider = {
    config: OAUTH_CONFIG,
    async verify(token: string) {
      verified.push(token);
      return tokens[token] ?? null;
    },
    async authorizationServerMetadata() {
      return {
        issuer: 'https://clerk.captureze.com',
        token_endpoint: 'https://clerk.captureze.com/oauth/token',
      };
    },
  };
  return { provider, verified };
}

/** Stands in for captureze.com/api and records what it was asked with. */
function upstream() {
  const authorizations: string[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    authorizations.push(headers.Authorization ?? '');
    return new Response(JSON.stringify({ plan: 'pro', isTrial: false }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, authorizations };
}

function callTool(base: string, headers: Record<string, string>) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'captureze_account_status', arguments: {} },
    }),
  });
}

describe('POST /mcp without OAuth configured', () => {
  it('still asks for a Captureze API key and nothing else', async () => {
    await withServer({}, async (base) => {
      const response = await callTool(base, {});

      assert.equal(response.status, 401);
      const body = (await response.json()) as { error: { message: string } };
      assert.match(body.error.message, /cap_/);
      assert.doesNotMatch(
        response.headers.get('www-authenticate') ?? '',
        /resource_metadata/,
        'there is no authorization server to point a client at',
      );
    });
  });

  it('serves no OAuth metadata a self-hosted install would have to explain', async () => {
    await withServer({}, async (base) => {
      const prm = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
      const as = await fetch(`${base}/.well-known/oauth-authorization-server`);
      assert.equal(prm.status, 404);
      assert.equal(as.status, 404);
    });
  });
});

describe('OAuth discovery', () => {
  it('publishes this endpoint as the protected resource and Clerk as its issuer', async () => {
    const { provider } = fakeOAuth();
    await withServer({ oauth: provider }, async (base) => {
      const response = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);

      assert.equal(response.status, 200);
      // Discovery happens from a browser origin the connector controls.
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(body.resource, 'https://mcp.captureze.com/mcp');
      assert.deepEqual(body.authorization_servers, ['https://clerk.captureze.com']);
    });
  });

  it('mirrors the authorization server metadata for clients that look here', async () => {
    const { provider } = fakeOAuth();
    await withServer({ oauth: provider }, async (base) => {
      const response = await fetch(`${base}/.well-known/oauth-authorization-server`);

      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      assert.equal(((await response.json()) as { issuer: string }).issuer, 'https://clerk.captureze.com');
    });
  });

  // This header is the whole flow: without the pointer a connector has no way
  // to discover that there is an authorization server at all.
  it('points an unauthenticated caller at the resource metadata, quoted', async () => {
    const { provider } = fakeOAuth();
    await withServer({ oauth: provider }, async (base) => {
      const response = await callTool(base, {});

      assert.equal(response.status, 401);
      assert.equal(
        response.headers.get('www-authenticate'),
        'Bearer realm="captureze", ' +
          'resource_metadata="https://mcp.captureze.com/.well-known/oauth-protected-resource/mcp"',
      );
    });
  });
});

describe('POST /mcp with OAuth configured', () => {
  it('keeps authenticating a Captureze API key without asking Clerk', async () => {
    const { provider, verified } = fakeOAuth();
    const api = upstream();
    await withServer({ oauth: provider, fetchImpl: api.fetchImpl }, async (base) => {
      const response = await callTool(base, { authorization: 'Bearer cap_live_key' });

      assert.equal(response.status, 200);
      assert.deepEqual(api.authorizations, ['Bearer cap_live_key']);
      assert.deepEqual(verified, [], 'an API key is not an OAuth token');
    });
  });

  it('accepts a verified OAuth token and calls the API as that caller', async () => {
    const { provider, verified } = fakeOAuth({
      oat_good: { userId: 'user_abc', clientId: 'client_x', scopes: ['openid'] },
    });
    const api = upstream();
    await withServer({ oauth: provider, fetchImpl: api.fetchImpl }, async (base) => {
      const response = await callTool(base, { authorization: 'Bearer oat_good' });

      assert.equal(response.status, 200);
      assert.deepEqual(verified, ['oat_good']);
      assert.deepEqual(api.authorizations, ['Bearer oat_good']);
    });
  });

  it('refuses a token Clerk does not recognise, and says why', async () => {
    const { provider } = fakeOAuth();
    const api = upstream();
    await withServer({ oauth: provider, fetchImpl: api.fetchImpl }, async (base) => {
      const response = await callTool(base, { authorization: 'Bearer oat_stale' });

      assert.equal(response.status, 401);
      const challenge = response.headers.get('www-authenticate') ?? '';
      assert.match(challenge, /error="invalid_token"/);
      assert.match(challenge, /resource_metadata="https:\/\/mcp\.captureze\.com\//);
      assert.deepEqual(api.authorizations, [], 'an unverified token never reaches the API');
    });
  });
});
