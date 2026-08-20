import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context.ts';
import { guard, jsonBlock, toolResult } from '../lib/format.ts';

export function registerDiffTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'captureze_compare_captures',
    {
      title: 'Compare two captures',
      description:
        'Pixel-diffs any two captures of the same site and reports how much of the page changed. ' +
        'Use it to answer "what changed between Monday and today?" after getting ids from captureze_list_captures. ' +
        'Requires the Pro plan (Full visual diff).',
      inputSchema: {
        capture_id_1: z.string().uuid().describe('Older capture id.'),
        capture_id_2: z.string().uuid().describe('Newer capture id.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ capture_id_1, capture_id_2 }) => {
      const result = await ctx.client.compareScreenshots(capture_id_1, capture_id_2);
      const percent = result.diffPercent ?? result.diff_percent ?? null;
      return toolResult(
        percent === null
          ? jsonBlock(result)
          : `${Number(percent).toFixed(2)}% of the page differs between the two captures.\n\n${jsonBlock(result)}`,
        { diff_percent: percent, raw: result },
      );
    }),
  );

  server.registerTool(
    'captureze_diff_trend',
    {
      title: 'Change history of a site',
      description:
        'Change percentage over the last captures of a site, oldest first — the shape of how much this page moves. ' +
        'Use it to spot when a page started changing. Requires the Pro plan (Full visual diff).',
      inputSchema: {
        site_id: z.string().uuid().describe('Site id from captureze_list_sites.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ site_id }) => {
      const { trend } = await ctx.client.diffTrend(site_id);
      const points = trend ?? [];
      const average =
        points.length > 0
          ? points.reduce((sum, point) => sum + (point.diff_percent ?? 0), 0) / points.length
          : null;
      return toolResult(
        points.length === 0
          ? `No diff history for site ${site_id} yet — it needs at least two captures.`
          : `${points.length} diffed capture(s), average change ${average!.toFixed(2)}%:\n\n${jsonBlock(points)}`,
        { trend: points, count: points.length, average_diff_percent: average },
      );
    }),
  );
}
