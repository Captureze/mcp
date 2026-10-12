import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context.ts';
import { geoVerificationFailure, guard, jsonBlock, toolError, toolResult } from '../lib/format.ts';
import { bySiteRecency, loadPublicSite, toPublicCapture, toPublicSite } from '../lib/public.ts';
import { CaptureStillRunningError } from '../lib/errors.ts';
import { idempotencyKey, takeCapture } from './capture.ts';
import { ensureSiteForUrl } from '../lib/ensure-site.ts';
import type { ScheduleInput } from '../lib/types.ts';

/**
 * A "site" in agent language is a `schedule` in the REST API: a URL plus the
 * capture settings and the cron that re-captures it. Tools are named after the
 * user-facing concept, not the table.
 */

const captureSettings = {
  full_page: z
    .boolean()
    .optional()
    .describe('Capture the whole scrollable page instead of just the viewport.'),
  viewport_preset: z
    .enum(['desktop', 'laptop', 'tablet', 'mobile', 'custom'])
    .optional()
    .describe('Device preset. tablet/mobile need the Starter plan or higher.'),
  width: z
    .number()
    .int()
    .min(320)
    .max(3840)
    .optional()
    .describe('Viewport width, with viewport_preset "custom".'),
  height: z
    .number()
    .int()
    .min(240)
    .max(4320)
    .optional()
    .describe('Viewport height, with viewport_preset "custom".'),
  output_format: z
    .enum(['png', 'jpeg', 'pdf'])
    .optional()
    .describe('Output format. pdf needs the Starter plan or higher.'),
  geo_country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .describe('Capture from this country (ISO 3166-1 alpha-2, e.g. "DE"). Needs the Pro plan or higher.'),
  geo_city: z
    .string()
    .max(100)
    .optional()
    .describe('Capture from this city. Requires geo_country and the Business plan.'),
  wait_for_selector: z.string().max(500).optional().describe('CSS selector to wait for before capturing.'),
  hide_selectors: z
    .array(z.string().max(500))
    .max(50)
    .optional()
    .describe('CSS selectors hidden before capturing (cookie bars, chat widgets).'),
  dismiss_cookie_banners: z
    .boolean()
    .optional()
    .describe('Try to dismiss the cookie banner before capturing.'),
} as const;

export function registerSiteTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'captureze_list_sites',
    {
      title: 'List monitored sites',
      description:
        'Lists every site (URL + capture settings + schedule) in the Captureze account, ordered by last capture, ' +
        'newest first; sites never captured come last. ' +
        'Start here when the user refers to a site by name — the returned id is what every other tool needs.',
      inputSchema: {},
      annotations: { title: 'List monitored sites', readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      const schedules = await ctx.client.listSchedules();
      const sites = schedules.map(toPublicSite).sort(bySiteRecency);
      return toolResult(
        sites.length === 0
          ? 'No sites in this Captureze account yet. Use captureze_capture_url to capture one ad hoc, or captureze_monitor_site to start tracking one on a schedule.'
          : `${sites.length} site(s):\n\n${jsonBlock(sites)}`,
        { sites, count: sites.length },
      );
    }),
  );

  server.registerTool(
    'captureze_get_site',
    {
      title: 'Get one monitored site',
      description:
        'Full configuration of one site — schedule and timezone, viewport, output format, geo, capture recipe ' +
        '(single or consent_flow, with its accept/reject selectors) — plus its last capture. The same site object ' +
        'every other tool returns.',
      inputSchema: {
        site_id: z.string().uuid().describe('Site id from captureze_list_sites.'),
      },
      annotations: { title: 'Get one monitored site', readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ site_id }) => {
      const site = await loadPublicSite(ctx.client, site_id);
      return toolResult(jsonBlock(site), { site });
    }),
  );

  server.registerTool(
    'captureze_monitor_site',
    {
      title: 'Start monitoring a site',
      description:
        'Creates a site that Captureze re-captures on a cron schedule and diffs against the previous capture. ' +
        'Use this when the user wants ongoing tracking ("watch this page", "tell me when it changes"). ' +
        'For a single screenshot right now, use captureze_capture_url instead. ' +
        'If the account already has a site for this URL — for example one an earlier captureze_capture_url created ' +
        'paused — that site is resumed and updated instead of duplicated, keeping its capture history. ' +
        'Creating or resuming a monitor takes one capture right away, as the baseline later captures are diffed ' +
        'against: it uses one capture credit and is returned as initial_capture. Changing only the schedule of a ' +
        'site already being monitored takes none (initial_capture null). ' +
        "A new site counts against the account's site limit.",
      inputSchema: {
        url: z.string().url().describe('Page to monitor.'),
        cron_expression: z
          .string()
          .min(5)
          .max(100)
          .describe('5-field cron, e.g. "0 9 * * *" for daily at 09:00. The plan sets the minimum interval.'),
        name: z.string().max(255).optional().describe('Display name. Defaults to the host + path.'),
        timezone: z
          .string()
          .max(64)
          .optional()
          .describe(
            'IANA timezone the cron is written in, e.g. "Europe/Berlin". Defaults to the server zone.',
          ),
        diff_threshold: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Percent of changed pixels that counts as a real change (default 5).'),
        notify_on_diff: z
          .boolean()
          .optional()
          .describe('Notify the account owner when a change exceeds the threshold.'),
        idempotency_key: idempotencyKey,
        ...captureSettings,
      },
      annotations: {
        title: 'Start monitoring a site',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard(async ({ url, name, cron_expression, idempotency_key, ...rest }) => {
      const { schedule, created, changed, resumed } = await ensureSiteForUrl({
        client: ctx.client,
        url,
        monitor: true,
        cronExpression: cron_expression,
        ...(name ? { name } : {}),
        settings: rest as Partial<ScheduleInput>,
        applySettingsToExisting: true,
        // The baseline is taken explicitly below, where its result can be
        // reported, rather than detached by the API where nobody sees it.
        captureOnCreate: false,
      });

      const initial = created || resumed ? await initialCapture(ctx, schedule.id, idempotency_key) : null;
      const site = await loadPublicSite(ctx.client, schedule.id);

      const summary = created
        ? `Now monitoring ${site.url} on "${site.cron_expression}" (${site.timezone ?? 'server zone'}), new site, id ${site.id}.`
        : changed.length > 0
          ? `Now monitoring ${site.url} on "${site.cron_expression}" (${site.timezone ?? 'server zone'}), existing site ${site.id}, capture history kept: ${changed.join('; ')}.`
          : `Already monitoring ${site.url} on "${site.cron_expression}" (site ${site.id}); nothing to change.`;
      return toolResult(
        [summary, initial?.note ?? 'No capture taken now (initial_capture null).', '', jsonBlock(site)].join(
          '\n',
        ),
        {
          site,
          site_created: created,
          site_changes: changed,
          initial_capture: initial?.capture ?? null,
          ...(initial?.pending ? { initial_capture_pending: initial.pending } : {}),
          ...(initial?.error ? { initial_capture_error: initial.error } : {}),
        },
      );
    }),
  );

  server.registerTool(
    'captureze_update_site',
    {
      title: 'Update a monitored site',
      description:
        'Changes the schedule or capture settings of an existing site. Only the fields you pass are changed. ' +
        'Set is_active false to pause monitoring without losing capture history.',
      inputSchema: {
        site_id: z.string().uuid().describe('Site id from captureze_list_sites.'),
        name: z.string().max(255).optional(),
        url: z.string().url().optional(),
        cron_expression: z.string().min(5).max(100).optional(),
        timezone: z.string().max(64).optional(),
        is_active: z
          .boolean()
          .optional()
          .describe('false pauses scheduled captures; manual captures still work.'),
        diff_threshold: z.number().int().min(1).max(100).optional(),
        notify_on_diff: z.boolean().optional(),
        ...captureSettings,
      },
      annotations: {
        title: 'Update a monitored site',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async ({ site_id, ...patch }) => {
      await ctx.client.updateSchedule(site_id, patch as never);
      const site = await loadPublicSite(ctx.client, site_id);
      return toolResult(`Updated site ${site_id}.\n\n${jsonBlock(site)}`, { site });
    }),
  );

  server.registerTool(
    'captureze_delete_site',
    {
      title: 'Delete a monitored site',
      description:
        'Permanently deletes a site AND its capture history, diffs and certificates. This cannot be undone — ' +
        'confirm with the user first, and prefer captureze_update_site with is_active false to merely pause.',
      inputSchema: {
        site_id: z.string().uuid().describe('Site id from captureze_list_sites.'),
      },
      annotations: {
        title: 'Delete a monitored site',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard(async ({ site_id }) => {
      await ctx.client.deleteSchedule(site_id);
      return toolResult(`Deleted site ${site_id} and its captures.`, { deleted_site_id: site_id });
    }),
  );
}

interface InitialCapture {
  capture: { capture_id: string; captured_at: string | null; image_url: string | null } | null;
  pending?: { run_id: string; idempotency_key: string };
  error?: string;
  note: string;
}

/**
 * The baseline capture of a new or resumed monitor. The monitor stands
 * whatever happens here: a page that refuses this one capture is still worth
 * watching, so a failure is reported next to the site, not instead of it.
 */
async function initialCapture(
  ctx: ToolContext,
  siteId: string,
  key: string | undefined,
): Promise<InitialCapture> {
  try {
    const { outcome } = await takeCapture(ctx, siteId, {}, key);
    const shot = toPublicCapture(outcome.screenshot, ctx.client.baseUrl);
    const capture = { capture_id: shot.capture_id, captured_at: shot.captured_at, image_url: shot.image_url };
    const geoProblem = geoVerificationFailure(outcome.screenshot, ctx.client.baseUrl);
    return {
      capture,
      note: geoProblem
        ? `Took the first capture (${shot.capture_id}), one capture credit — but: ${geoProblem}`
        : outcome.source === 'replayed'
          ? `Returned the first capture already taken for this idempotency_key (${shot.capture_id}); nothing billed again.`
          : `Took the first capture now (${shot.capture_id}, one capture credit) as the baseline for change detection.`,
    };
  } catch (error) {
    if (error instanceof CaptureStillRunningError) {
      return {
        capture: null,
        pending: { run_id: error.executionId, idempotency_key: error.idempotencyKey },
        note: error.message,
      };
    }
    const text = toolError(error)
      .content.map((block) => ('text' in block ? block.text : ''))
      .join('\n');
    return {
      capture: null,
      error: text,
      note: `The site is monitored, but its first capture failed: ${text}`,
    };
  }
}
