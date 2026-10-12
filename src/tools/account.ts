import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context.ts';
import { guard, jsonBlock, toolResult } from '../lib/format.ts';
import { toPublicAccount } from '../lib/public.ts';

export function registerAccountTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'captureze_account_status',
    {
      title: 'Account plan and usage',
      description:
        'Current plan, trial state, feature entitlements and usage against the limits (sites, captures this billing ' +
        'period, minimum capture interval in minutes). `features` lists every entitlement the plan includes — ' +
        'higher plans include everything lower ones do — by key: full_visual_diff, certificates, geo_country, ' +
        'geo_city, pdf_output, mobile_tablet_viewports, consent_flow and more. Check it before promising the user ' +
        'a feature, and after a 402 error, to say what needs upgrading.',
      inputSchema: {},
      annotations: { title: 'Account plan and usage', readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      const account = toPublicAccount(await ctx.client.getBilling());
      return toolResult(
        `Plan: ${account.plan ?? 'unknown'}${account.is_trial ? ' (trial)' : ''}\n\n${jsonBlock(account)}`,
        { account },
      );
    }),
  );
}
