import type { Capture, CaptureListResult } from '../types/capture.types.js';
import type { Monitor, MonitorListResult } from '../types/monitor.types.js';
import type { Account } from '../types/account.types.js';

export function formatCapture(capture: Capture): string {
  const lines: string[] = [
    `**Capture ID:** ${capture.id}`,
    `**URL:** ${capture.url}`,
    `**Status:** ${capture.status}`,
  ];
  if (capture.imageUrl) lines.push(`**Image URL:** ${capture.imageUrl}`);
  if (capture.thumbnailUrl) lines.push(`**Thumbnail:** ${capture.thumbnailUrl}`);
  if (capture.width || capture.height) {
    lines.push(`**Dimensions:** ${capture.width ?? '?'}×${capture.height ?? '?'}`);
  }
  if (capture.format) lines.push(`**Format:** ${capture.format}`);
  if (capture.fullPage !== undefined) lines.push(`**Full Page:** ${capture.fullPage}`);
  lines.push(`**Created:** ${capture.createdAt}`);
  return lines.join('\n');
}

export function formatCaptureList(result: CaptureListResult): string {
  if (result.data.length === 0) {
    return 'No captures found.';
  }
  const header = `Found **${result.total}** capture(s) (page ${result.page}, limit ${result.limit}):\n`;
  const items = result.data.map((c) => `- \`${c.id}\` — ${c.url} [${c.status}]`);
  return header + items.join('\n');
}

export function formatMonitor(monitor: Monitor): string {
  const lines: string[] = [
    `**Monitor ID:** ${monitor.id}`,
    `**Name:** ${monitor.name}`,
    `**URL:** ${monitor.url}`,
    `**Interval:** ${monitor.interval}`,
    `**Status:** ${monitor.status}`,
    `**Notify on Change:** ${monitor.notifyOnChange ?? false}`,
  ];
  if (monitor.lastCaptureAt) lines.push(`**Last Capture:** ${monitor.lastCaptureAt}`);
  lines.push(`**Created:** ${monitor.createdAt}`);
  return lines.join('\n');
}

export function formatMonitorList(result: MonitorListResult): string {
  if (result.data.length === 0) {
    return 'No monitors found.';
  }
  const header = `Found **${result.total}** monitor(s) (page ${result.page}, limit ${result.limit}):\n`;
  const items = result.data.map(
    (m) => `- \`${m.id}\` — **${m.name}** | ${m.url} [${m.status}]`,
  );
  return header + items.join('\n');
}

export function formatAccount(account: Account): string {
  return [
    `**Account ID:** ${account.id}`,
    `**Email:** ${account.email}`,
    `**Plan:** ${account.plan}`,
    `**Captures:** ${account.captures.used} / ${account.captures.limit}`,
    `**Monitors:** ${account.monitors.used} / ${account.monitors.limit}`,
  ].join('\n');
}
