import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext } from './context.ts';
import { ensureSiteForUrl } from '../lib/ensure-site.ts';
import {
  describeCapture,
  formatBytes,
  guard,
  jsonBlock,
  resolveCaptureUrl,
  toolResult,
} from '../lib/format.ts';
import type { Screenshot } from '../lib/types.ts';

const captureOptions = {
  full_page: z.boolean().optional().describe('Capture the whole scrollable page instead of just the viewport.'),
  viewport_preset: z
    .enum(['desktop', 'laptop', 'tablet', 'mobile', 'custom'])
    .optional()
    .describe('Device preset. tablet/mobile need the Starter plan or higher.'),
  width: z.number().int().min(320).max(3840).optional(),
  height: z.number().int().min(240).max(4320).optional(),
  output_format: z.enum(['png', 'jpeg', 'pdf']).optional().describe('pdf needs the Starter plan or higher.'),
  geo_country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .describe('Capture from this country (ISO 3166-1 alpha-2). Needs the Pro plan or higher.'),
  geo_city: z.string().max(100).optional().describe('Requires geo_country and the Business plan.'),
  wait_for_selector: z.string().max(500).optional(),
  hide_selectors: z.array(z.string().max(500)).max(50).optional(),
  dismiss_cookie_banners: z.boolean().optional(),
} as const;

/**
 * Turns a stored capture into content the model can actually look at. Large
 * files stay as a link — a 12 MB full-page PNG in base64 blows past most
 * clients' message limits and helps nobody.
 */
async function imageContent(
  ctx: ToolContext,
  screenshot: Screenshot,
): Promise<{ blocks: CallToolResult['content']; note: string }> {
  const url = resolveCaptureUrl(screenshot, ctx.client.baseUrl);
  if (!url) return { blocks: [], note: 'The capture has no downloadable URL yet.' };

  const isPdf = url.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    return { blocks: [], note: `PDF capture stored at ${url}` };
  }

  const image = await ctx.client.downloadImage(url);
  if (image.bytes > ctx.config.maxInlineImageBytes) {
    return {
      blocks: [],
      note: `Image is ${formatBytes(image.bytes)}, too large to inline — open ${url}`,
    };
  }
  return {
    blocks: [{ type: 'image', data: image.data, mimeType: image.mimeType }],
    note: `Image inlined (${formatBytes(image.bytes)}).`,
  };
}

function captureSummary(screenshot: Screenshot, baseUrl: string, prefix: string): string {
  const described = describeCapture(screenshot, baseUrl);
  const diff =
    screenshot.diff_percent === null || screenshot.diff_percent === undefined
      ? 'no previous capture to diff against'
      : `${Number(screenshot.diff_percent).toFixed(2)}% changed vs the previous capture`;
  return `${prefix}\n${diff}.\n\n${jsonBlock(described)}`;
}

export function registerCaptureTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'captureze_capture_url',
    {
      title: 'Capture a URL now',
      description:
        'Takes a screenshot of a URL right now and returns the image plus how much it changed since the last capture ' +
        'of the same URL. Captures run through Captureze\'s residential/datacenter proxy pool, so bot-protected and ' +
        'geo-restricted pages work. This is the tool for "show me what this page looks like". ' +
        'The URL is stored as a site so later captures can be diffed against this one; a site for the same URL is ' +
        'reused instead of duplicated, and new ones are created paused unless monitor is true. ' +
        'Takes 10-60 seconds — do not call it repeatedly for the same URL.',
      inputSchema: {
        url: z.string().url().describe('Page to capture.'),
        monitor: z
          .boolean()
          .optional()
          .describe('Also keep capturing it on a schedule (default false: one-off, site stays paused).'),
        cron_expression: z
          .string()
          .min(5)
          .max(100)
          .optional()
          .describe('Schedule to use when monitor is true, e.g. "0 9 * * *". Defaults to daily.'),
        include_image: z
          .boolean()
          .optional()
          .describe('Return the image itself, not just its URL (default true).'),
        ...captureOptions,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guard(async ({ url, monitor, cron_expression, include_image, ...settings }) => {
      const { schedule, created } = await ensureSiteForUrl({
        client: ctx.client,
        url,
        settings,
        monitor: monitor ?? false,
        ...(cron_expression ? { cronExpression: cron_expression } : {}),
      });

      const screenshot = await ctx.client.capture(schedule.id);
      const { blocks, note } = (include_image ?? true)
        ? await imageContent(ctx, screenshot)
        : { blocks: [] as CallToolResult['content'], note: 'Image not requested.' };

      const prefix = created
        ? `Captured ${url} (new site "${schedule.name}", id ${schedule.id}, ${monitor ? `monitoring on "${schedule.cron_expression}"` : 'paused — no scheduled captures'}).`
        : `Captured ${url} (existing site "${schedule.name}", id ${schedule.id}).`;

      return toolResult(
        `${captureSummary(screenshot, ctx.client.baseUrl, prefix)}\n${note}`,
        {
          ...describeCapture(screenshot, ctx.client.baseUrl),
          site_created: created,
          monitoring: schedule.is_active ?? false,
        },
        blocks,
      );
    }),
  );

  server.registerTool(
    'captureze_capture_site',
    {
      title: 'Capture an existing site now',
      description:
        'Runs an immediate capture of a site that already exists, using its stored settings, and diffs it against ' +
        'the previous capture. Use this instead of captureze_capture_url when the user points at a site by id or name.',
      inputSchema: {
        site_id: z.string().uuid().describe('Site id from captureze_list_sites.'),
        include_image: z.boolean().optional().describe('Return the image itself (default true).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guard(async ({ site_id, include_image }) => {
      const screenshot = await ctx.client.capture(site_id);
      const { blocks, note } = (include_image ?? true)
        ? await imageContent(ctx, screenshot)
        : { blocks: [] as CallToolResult['content'], note: 'Image not requested.' };
      return toolResult(
        `${captureSummary(screenshot, ctx.client.baseUrl, `Captured site ${site_id}.`)}\n${note}`,
        describeCapture(screenshot, ctx.client.baseUrl),
        blocks,
      );
    }),
  );

  server.registerTool(
    'captureze_list_captures',
    {
      title: 'List captures of a site',
      description:
        'Capture history for one site, newest first, with the change percentage of each capture against the one ' +
        'before it. Use it to answer "when did this page change?" and to get capture ids for diffing.',
      inputSchema: {
        site_id: z.string().uuid().describe('Site id from captureze_list_sites.'),
        limit: z.number().int().min(1).max(100).optional().describe('How many captures (default 10).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ site_id, limit }) => {
      const screenshots = await ctx.client.listScreenshots(site_id, limit ?? 10);
      const captures = screenshots.map((shot) => describeCapture(shot, ctx.client.baseUrl));
      return toolResult(
        captures.length === 0
          ? `Site ${site_id} has no captures yet. Run captureze_capture_site to make one.`
          : `${captures.length} capture(s) for site ${site_id}:\n\n${jsonBlock(captures)}`,
        { captures, count: captures.length },
      );
    }),
  );

  server.registerTool(
    'captureze_get_capture_image',
    {
      title: 'Look at a stored capture',
      description:
        'Returns the image of a stored capture so it can be examined. Defaults to the newest capture of the site. ' +
        'Use it to inspect what a page looked like at a point in time without capturing it again.',
      inputSchema: {
        site_id: z.string().uuid().describe('Site id from captureze_list_sites.'),
        capture_id: z.string().uuid().optional().describe('Specific capture. Defaults to the newest one.'),
        variant: z
          .enum(['screenshot', 'diff'])
          .optional()
          .describe('"diff" returns the highlighted change overlay, when one exists (default "screenshot").'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ site_id, capture_id, variant }) => {
      const screenshots = await ctx.client.listScreenshots(site_id, 100);
      const screenshot = capture_id
        ? screenshots.find((shot) => shot.id === capture_id)
        : screenshots[0];

      if (!screenshot) {
        return toolResult(
          capture_id
            ? `Capture ${capture_id} is not among the last 100 captures of site ${site_id}.`
            : `Site ${site_id} has no captures yet.`,
          { found: false },
        );
      }

      const wantDiff = variant === 'diff';
      const described = describeCapture(screenshot, ctx.client.baseUrl);
      const target = wantDiff ? described.diff_image_url : described.image_url;
      if (typeof target !== 'string') {
        return toolResult(
          wantDiff
            ? `Capture ${screenshot.id} has no diff overlay (it is the first capture, or nothing changed).`
            : `Capture ${screenshot.id} has no stored image.`,
          { ...described, found: true },
        );
      }

      const image = await ctx.client.downloadImage(target);
      if (image.bytes > ctx.config.maxInlineImageBytes) {
        return toolResult(
          `Image is ${formatBytes(image.bytes)}, too large to inline — open ${target}`,
          { ...described, inlined: false },
        );
      }

      return toolResult(
        `${wantDiff ? 'Diff overlay' : 'Capture'} ${screenshot.id} (${formatBytes(image.bytes)}):\n\n${jsonBlock(described)}`,
        { ...described, inlined: true },
        [{ type: 'image', data: image.data, mimeType: image.mimeType }],
      );
    }),
  );

  server.registerTool(
    'captureze_list_capture_runs',
    {
      title: 'List capture runs of a site',
      description:
        'Execution log for a site: when each scheduled or manual capture ran, whether it succeeded, how long it took ' +
        'and the error if it failed. Use this to debug "why is this site not updating?".',
      inputSchema: {
        site_id: z.string().uuid().describe('Site id from captureze_list_sites.'),
        limit: z.number().int().min(1).max(100).optional().describe('How many runs (default 20).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ site_id, limit }) => {
      const executions = await ctx.client.listExecutions(site_id, limit ?? 20);
      const runs = executions.map((run) => ({
        id: run.id,
        status: run.status,
        started_at: run.started_at ?? null,
        duration_ms: run.duration_ms ?? null,
        error: run.error_message ?? null,
        capture_id: run.screenshot_id ?? null,
      }));
      return toolResult(
        runs.length === 0 ? `No capture runs recorded for site ${site_id}.` : jsonBlock(runs),
        { runs, count: runs.length },
      );
    }),
  );
}
