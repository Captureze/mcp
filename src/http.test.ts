import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createHttpApp, type HttpOptions } from './http.ts';
import { loadConfig } from './lib/config.ts';
import type { FetchLike } from './lib/client.ts';
import type { OAuthConfig, OAuthProvider, VerifiedToken } from './lib/oauth.ts';

const CONFIG = loadConfig({ CAPTUREZE_BASE_URL: 'https://captureze.com' } as NodeJS.ProcessEnv);

/**
 * Every path a connector may probe. The spec-derived ones are what the `401`
 * points at; the rest are what clients ask for when they have no pointer, which
 * is how ChatGPT's connector looks for an authorization server.
 */
const PROTECTED_RESOURCE_PATHS = [
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-protected-resource',
];
const AUTHORIZATION_SERVER_PATHS = [
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/mcp',
  '/.well-known/openid-configuration',
  '/.well-known/openid-configuration/mcp',
];

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
      for (const path of [...PROTECTED_RESOURCE_PATHS, ...AUTHORIZATION_SERVER_PATHS]) {
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 404, `${path} should not exist without OAuth configured`);
      }
    });
  });
});

describe('OAuth discovery', () => {
  it('publishes this endpoint as the protected resource and Clerk as its issuer', async () => {
    const { provider } = fakeOAuth();
    await withServer({ oauth: provider }, async (base) => {
      // Including on the bare path: a client that probed the fallback is still
      // talking to /mcp, so that is the resource the document has to name.
      for (const path of PROTECTED_RESOURCE_PATHS) {
        const response = await fetch(`${base}${path}`);

        assert.equal(response.status, 200, path);
        // Discovery happens from a browser origin the connector controls.
        assert.equal(response.headers.get('access-control-allow-origin'), '*', path);
        const body = (await response.json()) as Record<string, unknown>;
        assert.equal(body.resource, 'https://mcp.captureze.com/mcp', path);
        assert.deepEqual(body.authorization_servers, ['https://clerk.captureze.com'], path);
      }
    });
  });

  // ChatGPT asks this origin for both document names directly and gives up if
  // neither answers, so every name a connector may try serves the same mirror.
  it('mirrors the authorization server metadata on every path a client tries', async () => {
    const { provider } = fakeOAuth();
    await withServer({ oauth: provider }, async (base) => {
      for (const path of AUTHORIZATION_SERVER_PATHS) {
        const response = await fetch(`${base}${path}`);

        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get('access-control-allow-origin'), '*', path);
        const body = (await response.json()) as { issuer: string };
        assert.equal(body.issuer, 'https://clerk.captureze.com', path);
      }
    });
  });

  it('answers the CORS preflight a browser-side connector sends first', async () => {
    const { provider } = fakeOAuth();
    await withServer({ oauth: provider }, async (base) => {
      for (const path of [...PROTECTED_RESOURCE_PATHS, ...AUTHORIZATION_SERVER_PATHS]) {
        const response = await fetch(`${base}${path}`, { method: 'OPTIONS' });

        assert.equal(response.status, 204, path);
        assert.equal(response.headers.get('access-control-allow-origin'), '*', path);
      }
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

describe('GET /mcp', () => {
  // A connector that does not know how to authenticate yet probes the endpoint
  // with a bare GET. A 405 tells it nothing; the 401 carries the pointer.
  it('challenges an unauthenticated probe instead of answering 405', async () => {
    const { provider } = fakeOAuth();
    await withServer({ oauth: provider }, async (base) => {
      const response = await fetch(`${base}/mcp`);

      assert.equal(response.status, 401);
      assert.match(
        response.headers.get('www-authenticate') ?? '',
        /resource_metadata="https:\/\/mcp\.captureze\.com\/\.well-known\/oauth-protected-resource\/mcp"/,
      );
    });
  });

  it('tells a credentialed caller that the stream half does not exist', async () => {
    const { provider } = fakeOAuth();
    await withServer({ oauth: provider }, async (base) => {
      const response = await fetch(`${base}/mcp`, {
        headers: { authorization: 'Bearer cap_live_key' },
      });

      assert.equal(response.status, 405);
      const body = (await response.json()) as { error: { message: string } };
      assert.match(body.error.message, /stateless/i);
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

describe('malformed requests', () => {
  // A JSON-RPC endpoint that answers HTML is a surprise to every client, and
  // express's default handler also logs the parse error as an unhandled stack
  // trace — which anyone can trigger from the open internet, for free.
  it('answers a JSON-RPC parse error for a body that is not JSON', async () => {
    await withServer({}, async (base) => {
      const response = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer cap_live_key',
        },
        body: '{not json',
      });

      assert.equal(response.status, 400);
      assert.match(response.headers.get('content-type') ?? '', /application\/json/);
      const body = (await response.json()) as { jsonrpc: string; error: { code: number } };
      assert.equal(body.jsonrpc, '2.0');
      assert.equal(body.error.code, -32700, 'the JSON-RPC code for a parse error');
    });
  });

  it('answers a JSON-RPC error when the body is too large', async () => {
    await withServer({}, async (base) => {
      const response = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer cap_live_key',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x', params: { blob: 'x'.repeat(5_000_000) } }),
      });

      assert.equal(response.status, 413);
      const body = (await response.json()) as { jsonrpc: string; error: { message: string } };
      assert.equal(body.jsonrpc, '2.0');
      assert.match(body.error.message, /too large/i);
    });
  });
});
