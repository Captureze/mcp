import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context.ts';
import { guard, jsonBlock, toolResult } from '../lib/format.ts';

export function registerEvidenceTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'captureze_get_capture_certificate',
    {
      title: 'Get the capture certificate',
      description:
        'Returns the Certificate of Capture for a capture: SHA-256 of the image, capture timestamp, HTTP status, ' +
        'viewport, the country/city the capture was made from, and a public verification URL. ' +
        'This is what makes a capture usable as evidence (GDPR/consent audits, IP or ad disputes). ' +
        'Requires the Starter plan or higher.',
      inputSchema: {
        capture_id: z.string().uuid().describe('Capture id from captureze_list_captures.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ capture_id }) => {
      const certificate = await ctx.client.getCertificate(capture_id);
      return toolResult(
        `Certificate ${certificate.certificate_id} for ${certificate.page_url}, captured ${certificate.captured_at}. ` +
          `Verify at ${certificate.verify_url}.\n\n${jsonBlock(certificate)}`,
        { certificate },
      );
    }),
  );
}
