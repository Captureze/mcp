import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context.ts';
import { guard, jsonBlock, toolResult } from '../lib/format.ts';

export function registerConsentTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'captureze_detect_consent_banner',
    {
      title: 'Detect the cookie/consent banner',
      description:
        'Finds the cookie consent banner on a page and returns the selectors for its accept/reject buttons, the CMP ' +
        'it uses and a confidence score. Feed the selectors into a consent_flow site to capture a page before and ' +
        'after consent. Results are cached per domain, so a cached answer comes back immediately; otherwise this ' +
        'returns a job_id to poll with captureze_get_consent_detection. Limited to 20 new domains per day.',
      inputSchema: {
        url: z.string().url().describe('Page to probe.'),
        geo_country: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .optional()
          .describe(
            'Probe from this country — banners differ by jurisdiction. Needs the Pro plan or higher.',
          ),
        geo_city: z.string().max(100).optional().describe('Requires geo_country and the Business plan.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ url, ...geo }) => {
      const response = await ctx.client.detectConsent({ url, ...geo });
      if (response.cached && response.result) {
        return toolResult(`Cached detection for ${url}:\n\n${jsonBlock(response.result)}`, {
          cached: true,
          result: response.result,
        });
      }
      return toolResult(
        `Detection started for ${url} (job ${response.job_id}, status ${response.status}). ` +
          'Poll captureze_get_consent_detection with that job id — it usually finishes within a minute.',
        { cached: false, job_id: response.job_id ?? null, status: response.status ?? 'pending' },
      );
    }),
  );

  server.registerTool(
    'captureze_get_consent_detection',
    {
      title: 'Get a consent detection result',
      description:
        'Result of a banner detection job started by captureze_detect_consent_banner. Poll at most once every few ' +
        'seconds; while status is "pending" or "running" there is nothing new to read.',
      inputSchema: {
        job_id: z.string().describe('Job id returned by captureze_detect_consent_banner.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ job_id }) => {
      const response = await ctx.client.getConsentDetection(job_id);
      return toolResult(jsonBlock(response), { detection: response });
    }),
  );
}
