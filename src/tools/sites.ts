import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context.ts';
import { describeSchedule, guard, jsonBlock, toolResult } from '../lib/format.ts';
import { siteLabel } from '../lib/url.ts';

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
        'Lists every site (URL + capture settings + schedule) in the Captureze account, newest capture first. ' +
        'Start here when the user refers to a site by name — the returned id is what every other tool needs.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      const schedules = await ctx.client.listSchedules();
      const sites = schedules.map(describeSchedule);
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
      description: 'Full configuration of one site, including capture recipe and geo settings.',
      inputSchema: {
        site_id: z.string().uuid().describe('Site id from captureze_list_sites.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ site_id }) => {
      const schedule = await ctx.client.getSchedule(site_id);
      return toolResult(jsonBlock(schedule), { site: describeSchedule(schedule) });
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
        "Counts against the account's site limit.",
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
        ...captureSettings,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    guard(async ({ url, name, ...rest }) => {
      const schedule = await ctx.client.createSchedule({
        name: name ?? siteLabel(url),
        url,
        is_active: true,
        ...rest,
      } as never);
      return toolResult(
        `Now monitoring ${schedule.url} on "${schedule.cron_expression}" (site id ${schedule.id}).`,
        { site: describeSchedule(schedule) },
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
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ site_id, ...patch }) => {
      const schedule = await ctx.client.updateSchedule(site_id, patch as never);
      return toolResult(`Updated site ${site_id}.`, { site: describeSchedule(schedule) });
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
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    guard(async ({ site_id }) => {
      await ctx.client.deleteSchedule(site_id);
      return toolResult(`Deleted site ${site_id} and its captures.`, { deleted_site_id: site_id });
    }),
  );
}
