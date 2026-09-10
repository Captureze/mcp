import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CapturezeClient, type FetchLike } from './lib/client.ts';
import type { ServerConfig } from './lib/config.ts';
import { jsonBlock } from './lib/format.ts';
import { registerAccountTools } from './tools/account.ts';
import { registerCaptureTools } from './tools/capture.ts';
import { registerChatGptTools } from './tools/chatgpt.ts';
import { registerConsentTools } from './tools/consent.ts';
import { registerDiffTools } from './tools/diff.ts';
import { registerEvidenceTools } from './tools/evidence.ts';
import { registerSiteTools } from './tools/sites.ts';
import type { ToolContext } from './tools/context.ts';

export const SERVER_NAME = 'captureze';
export const SERVER_VERSION = '0.1.0';

const INSTRUCTIONS = `Captureze captures screenshots of web pages — once, or on a schedule — through a
residential/datacenter proxy pool, keeps their history, and diffs each capture against the previous one.

Pick the tool by what the user is after:
- "what does this page look like" / "screenshot this" -> captureze_capture_url
- "watch this page" / "tell me when it changes" -> captureze_monitor_site
- "did it change" / "what changed" -> captureze_list_captures, then captureze_compare_captures
- "prove what it looked like" (legal, GDPR, ad compliance) -> captureze_get_capture_certificate
- cookie banner work -> captureze_detect_consent_banner

Captures take 10-60 seconds and cost the account a capture credit: never loop on the same URL. Plan limits
come back as errors that say what to upgrade — report them to the user instead of retrying.`;

export interface CreateServerOptions {
  config: ServerConfig;
  /**
   * Bearer credential this request runs as — a `cap_` API key or a Clerk OAuth
   * access token already verified by the transport. Both resolve to the same
   * Clerk user id at the API, so nothing below this line needs to know which
   * one it was handed.
   */
  accessToken: string;
  /** Test seam: injected HTTP implementation. */
  fetchImpl?: FetchLike;
  /** ChatGPT-compatible `search`/`fetch` tools (default true). */
  includeChatGptTools?: boolean;
}

export function createCapturezeServer({
  config,
  accessToken,
  fetchImpl,
  includeChatGptTools = true,
}: CreateServerOptions): McpServer {
  const client = CapturezeClient.fromConfig(config, accessToken, fetchImpl);
  const ctx: ToolContext = { client, config };

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS, capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  registerCaptureTools(server, ctx);
  registerSiteTools(server, ctx);
  registerDiffTools(server, ctx);
  registerEvidenceTools(server, ctx);
  registerConsentTools(server, ctx);
  registerAccountTools(server, ctx);
  if (includeChatGptTools) registerChatGptTools(server, ctx);

  registerResources(server, ctx);
  registerPrompts(server);

  return server;
}

function registerResources(server: McpServer, ctx: ToolContext): void {
  server.registerResource(
    'sites',
    'captureze://sites',
    {
      title: 'Monitored sites',
      description: 'Every site in the account with its schedule and latest capture.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const sites = await ctx.client.listSchedules();
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(sites, null, 2) }],
      };
    },
  );

  server.registerResource(
    'viewport-presets',
    'captureze://viewport-presets',
    {
      title: 'Viewport presets',
      description: 'Named device viewports accepted by the capture tools.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const presets = await ctx.client.viewportPresets();
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(presets, null, 2) }],
      };
    },
  );
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'watch-page',
    {
      title: 'Watch a page for changes',
      description: 'Set up monitoring for a page and report what changed since the last capture.',
      argsSchema: {
        url: z.string().describe('Page to watch.'),
        cadence: z.string().optional().describe('How often, in plain words ("daily at 9", "every Monday").'),
      },
    },
    ({ url, cadence }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Set up Captureze monitoring for ${url}${cadence ? ` (${cadence})` : ''}.\n` +
              'Translate the cadence into a cron expression, check the account plan allows that interval, ' +
              'create the site, take a first capture, and show me what it looks like now.',
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'evidence-pack',
    {
      title: 'Capture evidence of a page',
      description: 'Capture a page and collect its certificate for use as evidence.',
      argsSchema: {
        url: z.string().describe('Page to put on the record.'),
        country: z.string().optional().describe('Country to capture from, e.g. "DE".'),
      },
    },
    ({ url, country }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Capture ${url} with Captureze${country ? ` from ${country}` : ''} and pull the Certificate of Capture ` +
              'for it. Report the capture timestamp, the SHA-256 of the image, where it was captured from, and the ' +
              'verification URL, then show me the screenshot.',
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'consent-audit',
    {
      title: 'Audit a cookie banner',
      description: 'Detect the consent banner on a site and document it.',
      argsSchema: {
        url: z.string().describe('Page to audit.'),
        country: z.string().optional().describe('Jurisdiction to probe from, e.g. "DE".'),
      },
    },
    ({ url, country }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Audit the cookie consent banner on ${url}${country ? ` as seen from ${country}` : ''} with Captureze: ` +
              'detect the banner, report the CMP and the accept/reject selectors it found, capture the page, and ' +
              'tell me whether rejecting is as easy as accepting.',
          },
        },
      ],
    }),
  );
}

/** Exported for the HTTP transport's diagnostics endpoint. */
export function serverInfo(): Record<string, unknown> {
  return { name: SERVER_NAME, version: SERVER_VERSION };
}

export { jsonBlock };
