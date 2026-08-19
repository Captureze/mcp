import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context.ts';
import { describeCapture, guard, resolveCaptureUrl } from '../lib/format.ts';
import type { Schedule } from '../lib/types.ts';

/**
 * ChatGPT compatibility layer.
 *
 * ChatGPT connectors (and deep research in particular) require a server to
 * expose exactly two tools — `search` and `fetch`, each taking a single string
 * — and deep research will not use anything else. They are thin views over the
 * same account data the captureze_* tools serve, so other clients can ignore
 * them.
 *
 * The result payload also goes out as a JSON string in the text content, which
 * is the shape ChatGPT parses.
 */

const SITE_PREFIX = 'site:';
const CAPTURE_PREFIX = 'capture:';

interface SearchResult {
  id: string;
  title: string;
  text: string;
  url: string;
}

function siteConsoleUrl(baseUrl: string, siteId: string): string {
  return `${baseUrl}/app/sites/${siteId}`;
}

function siteSummary(site: Schedule): string {
  const parts = [
    `Monitored page ${site.url}.`,
    site.is_active ? `Captured on schedule "${site.cron_expression}".` : 'Scheduled capture paused.',
    site.last_screenshot_at ? `Last capture ${site.last_screenshot_at}.` : 'No captures yet.',
    site.last_diff_percent === null || site.last_diff_percent === undefined
      ? ''
      : `Last change ${Number(site.last_diff_percent).toFixed(2)}%.`,
  ];
  return parts.filter(Boolean).join(' ');
}

function matches(site: Schedule, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = `${site.name} ${site.url}`.toLowerCase();
  return needle.split(/\s+/).some((token) => haystack.includes(token));
}

export function registerChatGptTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'search',
    {
      title: 'Search Captureze',
      description:
        'Searches the Captureze account for monitored pages and their captures. Returns ids to pass to `fetch`. ' +
        'Query by domain, page name or URL fragment; an empty query lists everything.',
      inputSchema: {
        query: z.string().describe('Domain, site name or URL fragment.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ query }) => {
      const sites = (await ctx.client.listSchedules()).filter((site) => matches(site, query));
      const results: SearchResult[] = sites.map((site) => ({
        id: `${SITE_PREFIX}${site.id}`,
        title: site.name,
        text: siteSummary(site),
        url: siteConsoleUrl(ctx.client.baseUrl, site.id),
      }));

      // One level deeper for a small result set: the captures themselves are
      // what a research query is usually after.
      if (sites.length > 0 && sites.length <= 3) {
        for (const site of sites) {
          const captures = await ctx.client.listScreenshots(site.id, 5);
          for (const capture of captures) {
            results.push({
              id: `${CAPTURE_PREFIX}${site.id}:${capture.id}`,
              title: `${site.name} — capture ${capture.created_at ?? capture.id}`,
              text:
                `Capture of ${site.url} taken ${capture.created_at ?? 'at an unknown time'}. ` +
                (capture.diff_percent === null || capture.diff_percent === undefined
                  ? 'No diff against a previous capture.'
                  : `${Number(capture.diff_percent).toFixed(2)}% changed vs the previous capture.`),
              url: resolveCaptureUrl(capture, ctx.client.baseUrl) ?? siteConsoleUrl(ctx.client.baseUrl, site.id),
            });
          }
        }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ results }) }],
        structuredContent: { results },
      };
    }),
  );

  server.registerTool(
    'fetch',
    {
      title: 'Fetch a Captureze record',
      description:
        'Fetches the full record behind an id returned by `search`: a monitored page with its settings and recent ' +
        'captures, or one capture with its change percentage and image URL.',
      inputSchema: {
        id: z.string().describe('Id from `search`, e.g. "site:<uuid>" or "capture:<site-uuid>:<capture-uuid>".'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ id }) => {
      if (id.startsWith(CAPTURE_PREFIX)) {
        const [siteId, captureId] = id.slice(CAPTURE_PREFIX.length).split(':');
        if (!siteId || !captureId) throw new Error(`Malformed capture id "${id}".`);
        const captures = await ctx.client.listScreenshots(siteId, 100);
        const capture = captures.find((shot) => shot.id === captureId);
        if (!capture) throw new Error(`Capture ${captureId} not found on site ${siteId}.`);
        const described = describeCapture(capture, ctx.client.baseUrl);
        const document = {
          id,
          title: `Capture ${captureId}`,
          text: JSON.stringify(described, null, 2),
          url: (described.image_url as string | null) ?? siteConsoleUrl(ctx.client.baseUrl, siteId),
          metadata: { site_id: siteId, capture_id: captureId },
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(document) }],
          structuredContent: document,
        };
      }

      const siteId = id.startsWith(SITE_PREFIX) ? id.slice(SITE_PREFIX.length) : id;
      const site = await ctx.client.getSchedule(siteId);
      const captures = await ctx.client.listScreenshots(siteId, 10);
      const document = {
        id: `${SITE_PREFIX}${siteId}`,
        title: site.name,
        text: JSON.stringify(
          { site, recent_captures: captures.map((shot) => describeCapture(shot, ctx.client.baseUrl)) },
          null,
          2,
        ),
        url: siteConsoleUrl(ctx.client.baseUrl, siteId),
        metadata: { site_id: siteId, url: site.url },
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(document) }],
        structuredContent: document,
      };
    }),
  );
}
