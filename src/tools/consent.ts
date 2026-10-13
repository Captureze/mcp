import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context.ts';
import { guard, jsonBlock, toolResult } from '../lib/format.ts';
import { toPublicConsentResult } from '../lib/public.ts';

// How to read a result; both tools return the same shape.
const CONSENT_RESULT_GUIDE =
  'selector is a Puppeteer selector, which Captureze and Puppeteer run as is: ::-p-text("…") also matches the ' +
  "button's text and >>> reaches into a shadow root. For any other tool use css_selector (plain CSS, null for a " +
  'shadow root) and pick the element whose text is text. confidence: high = a known CMP whose accept and reject ' +
  'buttons both resolved; medium = found by wording and its Accept was clicked and dismissed the banner; low = an ' +
  'unverified guess, check banner_screenshot_url before relying on it. cmp_id names the vendor, "tcf-unknown" when ' +
  'the page runs a TCF consent API from a vendor not identified, null when no CMP showed itself. reject is null when ' +
  'the banner has no one-click refusal (a "pay or accept" wall, a refusal behind settings): a consent_flow site ' +
  'built from it captures pre_consent and post_accept only.';

export function registerConsentTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'captureze_detect_consent_banner',
    {
      title: 'Detect the cookie/consent banner',
      description:
        'Finds the cookie consent banner on a page and returns the selectors for its accept/reject buttons, the CMP ' +
        'it uses and a confidence score. Feed the selectors into a consent_flow site to capture a page before and ' +
        'after consent. Results are cached per domain, so a cached answer comes back immediately; otherwise this ' +
        'returns a job_id to poll with captureze_get_consent_detection. Limited to 20 new domains per day. ' +
        CONSENT_RESULT_GUIDE,
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
      annotations: {
        title: 'Detect the cookie/consent banner',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async ({ url, ...geo }) => {
      const response = await ctx.client.detectConsent({ url, ...geo });
      if (response.cached && response.result) {
        const result = toPublicConsentResult(response.result);
        return toolResult(`Cached detection for ${url}:\n\n${jsonBlock(result)}`, { cached: true, result });
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
        'seconds; while status is "pending" or "running" there is nothing new to read. ' +
        CONSENT_RESULT_GUIDE,
      inputSchema: {
        job_id: z.string().describe('Job id returned by captureze_detect_consent_banner.'),
      },
      annotations: { title: 'Get a consent detection result', readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ job_id }) => {
      const response = await ctx.client.getConsentDetection(job_id);
      const detection = {
        job_id: response.job_id ?? job_id,
        status: response.status ?? null,
        stage: response.stage ?? null,
        result: toPublicConsentResult(response.result),
        error: response.error ?? null,
      };
      return toolResult(jsonBlock(detection), { detection });
    }),
  );
}
