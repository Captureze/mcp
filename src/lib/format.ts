import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CapturezeApiError, CapturezeTimeoutError } from './errors.ts';
import type { Schedule, Screenshot } from './types.ts';

/** Successful tool result: a human/model-readable summary plus structured data. */
export function toolResult(
  summary: string,
  structured?: Record<string, unknown>,
  extraContent: CallToolResult['content'] = [],
): CallToolResult {
  return {
    content: [{ type: 'text', text: summary }, ...extraContent],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/** Failed tool result. Protocol errors are for transport problems, not this. */
export function toolError(error: unknown): CallToolResult {
  let text: string;
  if (error instanceof CapturezeApiError) {
    text = error.toString();
  } else if (error instanceof CapturezeTimeoutError) {
    text = error.message;
  } else if (error instanceof Error) {
    text = `${error.name}: ${error.message}`;
  } else {
    text = `Unexpected failure: ${String(error)}`;
  }
  return { content: [{ type: 'text', text }], isError: true };
}

/** Wraps a tool handler so every thrown error becomes a readable tool error. */
export function guard<Args>(
  handler: (args: Args) => Promise<CallToolResult>,
): (args: Args) => Promise<CallToolResult> {
  return async (args: Args) => {
    try {
      return await handler(args);
    } catch (error) {
      return toolError(error);
    }
  };
}

/**
 * The API returns the stored capture either as an absolute URL (user's own S3)
 * or as a path relative to the platform origin, and which field carries it
 * depends on the endpoint. Normalise to one absolute URL.
 */
export function resolveCaptureUrl(screenshot: Screenshot, baseUrl: string): string | null {
  const candidate =
    screenshot.url ?? screenshot.storage_url ?? (screenshot.file_path ? `/screenshots/${screenshot.file_path}` : null);
  if (!candidate) return null;
  try {
    return new URL(candidate, `${baseUrl}/`).toString();
  } catch {
    return null;
  }
}

export function resolveDiffUrl(screenshot: Screenshot, baseUrl: string): string | null {
  const candidate = screenshot.diff_url ?? screenshot.diff_image_url ?? null;
  if (!candidate) return null;
  try {
    return new URL(candidate, `${baseUrl}/`).toString();
  } catch {
    return null;
  }
}

export function describeSchedule(schedule: Schedule): Record<string, unknown> {
  return {
    id: schedule.id,
    name: schedule.name,
    url: schedule.url,
    cron_expression: schedule.cron_expression,
    timezone: schedule.timezone ?? null,
    monitoring_active: schedule.is_active ?? false,
    viewport:
      schedule.viewport_preset && schedule.viewport_preset !== 'custom'
        ? schedule.viewport_preset
        : `${schedule.width ?? 1920}x${schedule.height ?? 1080}`,
    full_page: schedule.full_page ?? false,
    output_format: schedule.output_format ?? 'png',
    geo: schedule.geo_country
      ? [schedule.geo_city, schedule.geo_country].filter(Boolean).join(', ')
      : null,
    last_capture_at: schedule.last_screenshot_at ?? null,
    last_diff_percent: schedule.last_diff_percent ?? null,
  };
}

export function describeCapture(screenshot: Screenshot, baseUrl: string): Record<string, unknown> {
  return {
    capture_id: screenshot.id,
    site_id: screenshot.schedule_id,
    captured_at: screenshot.created_at ?? null,
    image_url: resolveCaptureUrl(screenshot, baseUrl),
    diff_image_url: resolveDiffUrl(screenshot, baseUrl),
    diff_percent: screenshot.diff_percent ?? null,
    file_size_bytes: screenshot.file_size ?? null,
    proxy_tier: screenshot.proxy_tier ?? null,
    session_group: screenshot.session_group ?? null,
  };
}

/** Compact JSON block for lists — cheaper for the model than prose. */
export function jsonBlock(value: unknown): string {
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
