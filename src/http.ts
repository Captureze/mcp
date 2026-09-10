import express, { type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createCapturezeServer, SERVER_NAME, SERVER_VERSION } from './server.ts';
import type { ServerConfig } from './lib/config.ts';
import type { FetchLike } from './lib/client.ts';
import { protectedResourceMetadata, type OAuthProvider } from './lib/oauth.ts';

export interface HttpOptions {
  config: ServerConfig;
  port: number;
  host: string;
  /** Host header allowlist — required when binding to a public interface. */
  allowedHosts?: string[];
  /**
   * Turns on OAuth 2.1 as the MCP spec defines it. Absent — which is the case
   * for every self-hosted install — the endpoint is exactly what it was: a
   * `cap_` key in the Authorization header.
   */
  oauth?: OAuthProvider;
  /** Test seam: injected HTTP implementation for calls to the Captureze API. */
  fetchImpl?: FetchLike;
}

const API_KEY_PREFIX = 'cap_';
const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource/mcp';

/**
 * The credential a request arrived with, before we know whether it is any good.
 */
interface PresentedCredential {
  token: string;
  /** An API key is checked here; an OAuth token has to be checked with Clerk. */
  looksLikeApiKey: boolean;
}

/**
 * Every request carries its own credential, so one deployment serves many users
 * and nothing about a user survives between requests. That is also why each
 * request gets a fresh server + transport: with no session state there is
 * nothing to keep alive, and no way for one caller's identity to leak into
 * another's request.
 */
function credentialFromRequest(req: Request, config: ServerConfig): PresentedCredential | null {
  const authorization = req.header('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const value = authorization.slice(7).trim();
    if (value) return { token: value, looksLikeApiKey: value.startsWith(API_KEY_PREFIX) };
  }
  // Some clients can only attach arbitrary headers, not an Authorization one.
  const headerKey = req.header('x-api-key')?.trim();
  if (headerKey) return { token: headerKey, looksLikeApiKey: headerKey.startsWith(API_KEY_PREFIX) };
  // Single-tenant fallback. Never set on the hosted deployment.
  const envKey = config.apiKey;
  if (envKey) return { token: envKey, looksLikeApiKey: envKey.startsWith(API_KEY_PREFIX) };
  return null;
}

/**
 * This endpoint's own public origin. Pinned by configuration where it matters,
 * and otherwise read from the request — which is safe precisely because
 * `allowedHosts` has already refused any Host header we did not expect.
 */
function publicOrigin(req: Request, oauth?: OAuthProvider): string {
  const pinned = oauth?.config.publicUrl;
  if (pinned) return pinned;
  const forwarded = req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  return `${forwarded || req.protocol}://${req.get('host')}`;
}

/**
 * RFC 6750 challenge. With OAuth on it carries the RFC 9728 pointer, which is
 * the only thing telling a connector that an authorization server exists at
 * all — the value is quoted, because that is what the grammar says and clients
 * differ on how forgiving they are about it.
 */
function challenge(
  req: Request,
  res: Response,
  options: { oauth?: OAuthProvider; invalidToken?: boolean },
): void {
  const parts = ['realm="captureze"'];
  if (options.invalidToken) parts.push('error="invalid_token"');
  if (options.oauth) {
    parts.push(`resource_metadata="${publicOrigin(req, options.oauth)}${PROTECTED_RESOURCE_PATH}"`);
  }

  const message = options.invalidToken
    ? 'The access token is not valid. Re-authorize the connector, or send a Captureze API key as `Authorization: Bearer cap_...`.'
    : options.oauth
      ? 'Not authenticated. Connect this endpoint as an OAuth connector, or send a Captureze API key as `Authorization: Bearer cap_...` (create one under Settings -> API keys).'
      : 'Missing Captureze API key. Send it as `Authorization: Bearer cap_...` (create one in the Captureze console under Settings -> API keys).';

  res
    .status(401)
    .set('WWW-Authenticate', `Bearer ${parts.join(', ')}`)
    .json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null });
}

export function createHttpApp(options: HttpOptions) {
  const { config, oauth } = options;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));

  // express answers a malformed body with an HTML error page and logs the parse
  // failure as an unhandled stack trace. On a public JSON-RPC endpoint that is
  // both a surprise to clients and free log noise for anyone who sends junk.
  app.use((error: unknown, _req: Request, res: Response, next: express.NextFunction) => {
    if (!(error && typeof error === 'object' && 'status' in error)) return next(error);
    const status = Number((error as { status?: number }).status) || 400;
    const tooLarge = status === 413;
    res.status(status).json({
      jsonrpc: '2.0',
      error: {
        // -32700 is the JSON-RPC code for a body that could not be parsed.
        code: tooLarge ? -32600 : -32700,
        message: tooLarge
          ? 'Request body too large: this endpoint accepts up to 4mb.'
          : 'Parse error: the request body is not valid JSON.',
      },
      id: null,
    });
  });

  const allowedHosts = options.allowedHosts?.filter(Boolean) ?? [];
  if (allowedHosts.length > 0) {
    // DNS-rebinding protection for deployments that bind beyond localhost.
    app.use((req, res, next) => {
      const host = req.headers.host?.split(':')[0];
      if (host && !allowedHosts.includes(host)) {
        res.status(421).json({ error: `Host "${host}" is not allowed.` });
        return;
      }
      next();
    });
  }

  app.get('/healthz', (_req, res) => {
    res.json({
      status: 'ok',
      server: SERVER_NAME,
      version: SERVER_VERSION,
      upstream: config.baseUrl,
      oauth: Boolean(oauth),
    });
  });

  if (oauth) {
    // Discovery is fetched by the connector's browser context, so both
    // documents are public and both need CORS.
    const publicDocument = (_req: Request, res: Response, next: express.NextFunction) => {
      res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Cache-Control': 'public, max-age=3600',
      });
      next();
    };

    app.options(
      [PROTECTED_RESOURCE_PATH, '/.well-known/oauth-authorization-server'],
      publicDocument,
      (_req, res) => {
        res.status(204).end();
      },
    );

    app.get(PROTECTED_RESOURCE_PATH, publicDocument, (req, res) => {
      res.json(
        protectedResourceMetadata({
          resourceUrl: `${publicOrigin(req, oauth)}/mcp`,
          authorizationServerUrl: oauth.config.authorizationServerUrl,
          scopes: oauth.config.scopes,
        }),
      );
    });

    app.get('/.well-known/oauth-authorization-server', publicDocument, async (_req, res) => {
      try {
        res.json(await oauth.authorizationServerMetadata());
      } catch (error) {
        res.status(502).json({
          error: `Could not reach the authorization server: ${error instanceof Error ? error.message : 'unknown error'}`,
        });
      }
    });
  }

  app.post('/mcp', async (req, res) => {
    const presented = credentialFromRequest(req, config);
    if (!presented) {
      challenge(req, res, { oauth });
      return;
    }

    // The identity a request runs as. It is the credential itself: a Captureze
    // user *is* their Clerk user id, and both an API key and a verified OAuth
    // token resolve to that same id on the other end.
    let accessToken: string;
    if (presented.looksLikeApiKey) {
      accessToken = presented.token;
    } else if (oauth) {
      let verified;
      try {
        verified = await oauth.verify(presented.token);
      } catch (error) {
        // The authorization server is unreachable. Answering 401 here would
        // tell every connected client its token is bad and start a stampede of
        // re-authorizations over an outage that is not theirs.
        res.status(503).json({
          jsonrpc: '2.0',
          error: {
            code: -32003,
            message: `Could not verify the access token: ${error instanceof Error ? error.message : 'unknown error'}`,
          },
          id: null,
        });
        return;
      }
      if (!verified) {
        challenge(req, res, { oauth, invalidToken: true });
        return;
      }
      accessToken = presented.token;
    } else {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: `Captureze API keys start with "${API_KEY_PREFIX}".` },
        id: null,
      });
      return;
    }

    const server = createCapturezeServer({ config, accessToken, fetchImpl: options.fetchImpl });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: error instanceof Error ? error.message : 'Internal error' },
          id: null,
        });
      }
    }
  });

  // Stateless mode keeps no stream open between requests, so the server-push
  // half of Streamable HTTP has nothing to serve.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'This server runs stateless: use POST /mcp.' },
      id: null,
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  return app;
}

export function startHttpServer(options: HttpOptions): Promise<void> {
  const app = createHttpApp(options);
  return new Promise((resolve) => {
    const server = app.listen(options.port, options.host, () => {
      process.stderr.write(
        `[captureze-mcp] streamable HTTP on http://${options.host}:${options.port}/mcp -> ${options.config.baseUrl}` +
          `${options.oauth ? ` (OAuth via ${options.oauth.config.authorizationServerUrl})` : ''}\n`,
      );
      resolve();
    });
    const shutdown = () => server.close(() => process.exit(0));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
