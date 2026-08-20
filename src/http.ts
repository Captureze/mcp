import express, { type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createCapturezeServer, SERVER_NAME, SERVER_VERSION } from './server.ts';
import type { ServerConfig } from './lib/config.ts';

export interface HttpOptions {
  config: ServerConfig;
  port: number;
  host: string;
  /** Host header allowlist — required when binding to a public interface. */
  allowedHosts?: string[];
}

const API_KEY_PREFIX = 'cap_';

/**
 * Every request carries its own Captureze API key, so one deployment serves
 * many users and nothing about a user survives between requests. That is also
 * why each request gets a fresh server + transport: with no session state there
 * is nothing to keep alive, and no way for one caller's key to leak into
 * another's request.
 */
function apiKeyFromRequest(req: Request, config: ServerConfig): string | null {
  const authorization = req.header('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const value = authorization.slice(7).trim();
    if (value) return value;
  }
  // Some clients can only attach arbitrary headers, not an Authorization one.
  const headerKey = req.header('x-api-key')?.trim();
  if (headerKey) return headerKey;
  return config.apiKey ?? null;
}

function rejectUnauthorized(res: Response): void {
  res
    .status(401)
    .set('WWW-Authenticate', 'Bearer realm="captureze", error="invalid_token"')
    .json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message:
          'Missing Captureze API key. Send it as `Authorization: Bearer cap_...` (create one in the Captureze console under Settings -> API keys).',
      },
      id: null,
    });
}

export function createHttpApp(options: HttpOptions) {
  const { config } = options;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));

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
    res.json({ status: 'ok', server: SERVER_NAME, version: SERVER_VERSION, upstream: config.baseUrl });
  });

  app.post('/mcp', async (req, res) => {
    const apiKey = apiKeyFromRequest(req, config);
    if (!apiKey) {
      rejectUnauthorized(res);
      return;
    }
    if (!apiKey.startsWith(API_KEY_PREFIX)) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: `Captureze API keys start with "${API_KEY_PREFIX}".` },
        id: null,
      });
      return;
    }

    const server = createCapturezeServer({ config, apiKey });
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
        `[captureze-mcp] streamable HTTP on http://${options.host}:${options.port}/mcp -> ${options.config.baseUrl}\n`,
      );
      resolve();
    });
    const shutdown = () => server.close(() => process.exit(0));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
