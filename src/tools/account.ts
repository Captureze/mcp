import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from './context.ts';
import { guard, jsonBlock, toolResult } from '../lib/format.ts';
import type { BillingInfo } from '../lib/types.ts';

/**
 * What an agent needs to know about the account, and nothing else. The billing
 * endpoint also serves the dashboard, which shows proxy-tier counts and our
 * proxy spend; those are Captureze's internals, not the user's entitlements.
 */
export function describeAccount(billing: BillingInfo): Record<string, unknown> {
  const subscription = billing.subscription ?? null;
  return {
    plan: subscription?.plan ?? null,
    status: subscription?.status ?? null,
    is_trial: subscription?.isTrial ?? false,
    trial_days_remaining: subscription?.isTrial ? (subscription.trialDaysRemaining ?? null) : null,
    capture_paused: subscription?.isDormant ?? false,
    cancel_at_period_end: subscription?.cancelAtPeriodEnd ?? false,
    current_period_end: subscription?.currentPeriodEnd ?? null,
    limits: billing.limits ?? null,
    usage: billing.usage ?? null,
    // Entitlements by name, with inherited ones ("All Pro features") spelled out.
    features: Array.isArray(billing.features) ? billing.features : [],
    archive: billing.archive ?? null,
  };
}

export function registerAccountTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'captureze_account_status',
    {
      title: 'Account plan and usage',
      description:
        'Current plan, trial state, feature entitlements and usage against the limits (sites, captures this ' +
        'billing period, minimum capture interval). Check this before promising the user a feature — geo-targeting, ' +
        'PDF output, full visual diff and certificates are all plan-gated — and after a 402 error, to say what ' +
        'needs upgrading.',
      inputSchema: {},
      annotations: { title: 'Account plan and usage', readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      const account = describeAccount(await ctx.client.getBilling());
      return toolResult(
        `Plan: ${account.plan ?? 'unknown'}${account.is_trial ? ' (trial)' : ''}\n\n${jsonBlock(account)}`,
        { account },
      );
    }),
  );
}
