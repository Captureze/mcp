import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context.ts';
import { guard, jsonBlock, toolResult } from '../lib/format.ts';

export function registerAccountTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'captureze_account_status',
    {
      title: 'Account plan and usage',
      description:
        'Current plan, trial state, feature entitlements and usage against the limits (sites, captures, minimum ' +
        'capture interval). Check this before promising the user a feature — geo-targeting, PDF output, full visual ' +
        'diff and certificates are all plan-gated — and after a 402 error, to say what needs upgrading.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      const billing = await ctx.client.getBilling();
      return toolResult(
        `Plan: ${billing.plan ?? 'unknown'}${billing.isTrial ? ' (trial)' : ''}\n\n${jsonBlock(billing)}`,
        { account: billing },
      );
    }),
  );
}
