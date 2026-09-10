#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './lib/config.ts';
import { createCapturezeServer, SERVER_VERSION } from './server.ts';
import { startHttpServer } from './http.ts';
import { ClerkOAuthProvider, loadOAuthConfig } from './lib/oauth.ts';
import { isCliInvocation, runCli } from './cli/index.ts';

// `quiet` is not optional: dotenv announces itself on stdout, and stdout is the
// MCP stdio transport. One banner line and every client fails to parse the stream.
loadDotenv({ quiet: true });

interface Cli {
  http: boolean;
  port: number;
  host: string;
  allowedHosts: string[];
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    http: argv.includes('--http'),
    port: Number.parseInt(process.env.PORT ?? '8787', 10),
    host: process.env.HOST ?? '127.0.0.1',
    allowedHosts: (process.env.CAPTUREZE_MCP_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--port' && next) cli.port = Number.parseInt(next, 10);
    if (arg === '--host' && next) cli.host = next;
    if (arg === '--allowed-hosts' && next) {
      cli.allowedHosts = next
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }
  return cli;
}

function usage(): string {
  return `captureze-mcp ${SERVER_VERSION}

  captureze-mcp                 MCP server over stdio (Claude Code, Claude Desktop, OpenClaw, local agents)
  captureze-mcp --http          MCP server over Streamable HTTP (ChatGPT connectors, hosted agents)
  captureze-mcp <command>       run one tool by hand — see 'captureze-mcp --help'

Options
  --port <n>            HTTP port (default 8787, or $PORT)
  --host <addr>         HTTP bind address (default 127.0.0.1, or $HOST)
  --allowed-hosts a,b   Host header allowlist when binding beyond localhost

Environment
  CAPTUREZE_API_KEY     API key (cap_...). Required for stdio; the fallback for HTTP when a
                        request carries no Authorization header.
  CAPTUREZE_BASE_URL    Captureze install (default https://captureze.com)
  CAPTUREZE_TIMEOUT_MS  Upstream timeout in ms (default 180000)

OAuth (--http only, optional)
  Set both Clerk variables to let clients that can only speak OAuth — the claude.ai
  connector dialog among them — authorize against the same Clerk that logs into the
  app. API keys keep working exactly as before. Leave them unset and none of it loads.

  CLERK_PUBLISHABLE_KEY      pk_live_... / pk_test_... (names the authorization server)
  CLERK_SECRET_KEY           sk_live_... / sk_test_... (verifies access tokens)
  CAPTUREZE_MCP_PUBLIC_URL   this endpoint's public origin, e.g. https://mcp.captureze.com
                             (default: taken from the request)

A .env file in the working directory is loaded automatically.
`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // A command word means the human is driving; anything else starts the server,
  // so every existing client config keeps working untouched.
  if (isCliInvocation(argv)) {
    await runCli(argv);
    return;
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(usage());
    return;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }

  const cli = parseArgs(argv);
  const config = loadConfig();

  if (cli.http) {
    // OAuth is opt-in and configuration-driven: no Clerk variables, no OAuth,
    // and a self-hosted endpoint behaves exactly as it did before.
    const oauthConfig = loadOAuthConfig();
    await startHttpServer({
      config,
      port: cli.port,
      host: cli.host,
      allowedHosts: cli.allowedHosts,
      oauth: oauthConfig ? new ClerkOAuthProvider(oauthConfig) : undefined,
    });
    return;
  }

  if (!config.apiKey) {
    process.stderr.write(
      'CAPTUREZE_API_KEY is not set. Create a key in the Captureze console (Settings -> API keys) and set it in the MCP server config.\n',
    );
    process.exit(1);
  }

  const server = createCapturezeServer({ config, accessToken: config.apiKey });
  // stdout belongs to the protocol — every log line goes to stderr.
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[captureze-mcp] stdio ready -> ${config.baseUrl}\n`);
}

main().catch((error) => {
  process.stderr.write(`[captureze-mcp] fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
