import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context.ts';
import { formatBytes, guard, jsonBlock, toolResult } from '../lib/format.ts';

export function registerDiffTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'captureze_compare_captures',
    {
      title: 'Compare two captures',
      description:
        'Pixel-diffs any two captures of the same site and reports how much of the page changed. ' +
        'Use it to answer "what changed between Monday and today?" after getting ids from captureze_list_captures. ' +
        'Returns the percentage and the highlighted diff image. ' +
        'Needs the full_visual_diff entitlement (Pro plan or higher).',
      inputSchema: {
        capture_id_1: z.string().uuid().describe('Older capture id.'),
        capture_id_2: z.string().uuid().describe('Newer capture id.'),
      },
      annotations: { title: 'Compare two captures', readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ capture_id_1, capture_id_2 }) => {
      const result = await ctx.client.compareScreenshots(capture_id_1, capture_id_2);
      const raw = result.diffPercent ?? result.diff_percent;
      const percent = raw === null || raw === undefined ? null : Number(raw);

      // The API sends the overlay as a data: URL. It goes out as an image the
      // model can look at, never as a base64 string in the text.
      const dataUrl = typeof result.diffImageDataUrl === 'string' ? result.diffImageDataUrl : null;
      const match = dataUrl ? /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(dataUrl) : null;
      const bytes = match ? Math.floor((match[2]!.length * 3) / 4) : 0;
      const inline = match !== null && bytes <= ctx.config.maxInlineImageBytes;

      const summary =
        percent === null
          ? 'The two captures could not be compared pixel by pixel (different sizes or formats).'
          : `${percent.toFixed(2)}% of the page differs between capture ${capture_id_1} and capture ${capture_id_2}.`;
      return toolResult(
        `${summary}${match && !inline ? ` The diff image is ${formatBytes(bytes)}, too large to inline.` : ''}`,
        { capture_id_1, capture_id_2, diff_percent: percent, diff_image_inlined: inline },
        inline ? [{ type: 'image', data: match![2]!, mimeType: match![1]! }] : [],
      );
    }),
  );

  server.registerTool(
    'captureze_diff_trend',
    {
      title: 'Change history of a site',
      description:
        'Change percentage over the last captures of a site, oldest first — the shape of how much this page moves. ' +
        'Use it to spot when a page started changing. The last point is the newest diffed capture. ' +
        'Needs the full_visual_diff entitlement (Pro plan or higher).',
      inputSchema: {
        site_id: z.string().uuid().describe('Site id from captureze_list_sites.'),
      },
      annotations: { title: 'Change history of a site', readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ site_id }) => {
      const { trend } = await ctx.client.diffTrend(site_id);
      const points = (trend ?? []).map((point) => ({
        capture_id: point.id,
        captured_at: point.captured_at ?? point.created_at ?? null,
        diff_percent:
          point.diff_percent === null || point.diff_percent === undefined ? null : Number(point.diff_percent),
      }));
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
