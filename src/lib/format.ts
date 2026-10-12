import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CaptureStillRunningError, CapturezeApiError, CapturezeTimeoutError } from './errors.ts';
import type { Screenshot } from './types.ts';
import { toPublicCapture } from './public.ts';

export { resolveCaptureUrl, resolveDiffUrl } from './public.ts';

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
  } else if (error instanceof CapturezeTimeoutError || error instanceof CaptureStillRunningError) {
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
 * A capture that was asked for a country and could not confirm it is not a
 * success. The message names both countries and keeps the capture reachable —
 * the file and its certificate are still stored, they simply must not be
 * reported as something they are not.
 *
 * Returns null when there is nothing wrong to report.
 */
const GEO_STATUSES_THAT_PASS = new Set(['confirmed', 'not_requested']);

export function geoVerificationFailure(screenshot: Screenshot, baseUrl: string): string | null {
  const geo = screenshot.geo_verification;
  if (!geo) return null;

  // `status` is the source of truth and `honoured` only a convenience: a
  // response carrying status "mismatch" without the boolean must still fail,
  // or a version skew between this server and the API silently restores the
  // defect this check exists to catch.
  const passes = geo.honoured === true || GEO_STATUSES_THAT_PASS.has(geo.status);
  if (passes && geo.honoured !== false) return null;

  const requested = geo.requested_country ?? 'the requested country';
  const where =
    geo.observed_country && geo.observed_country !== geo.requested_country
      ? `it was served from ${geo.observed_country}`
      : 'the exit location could not be measured';

  return [
    `Capture of ${screenshot.url ?? screenshot.file_path ?? `site ${screenshot.schedule_id}`} was requested from ${requested}, but ${where}.`,
    geo.detail ?? '',
    '',
    'The capture and its certificate were kept and are listed below, but this capture does not',
    `attest to being made from ${requested}.`,
    '',
    jsonBlock(toPublicCapture(screenshot, baseUrl)),
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * A city that was asked for and not confirmed. Unlike a wrong country this does
 * not fail the capture — proxies target cities on a best-effort basis — but it
 * is said every time, never left for the reader to notice.
 */
export function cityVerificationNote(screenshot: Screenshot): string | null {
  const geo = screenshot.geo_verification;
  if (!geo?.requested_city || !geo.city_status || geo.city_status === 'confirmed') return null;
  const where = geo.observed_city
    ? `the exit was placed in ${geo.observed_city}`
    : 'the exit city could not be measured';
  return `City targeting was not honoured: ${geo.requested_city} was requested, but ${where}. ${geo.city_detail ?? ''}`.trim();
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
