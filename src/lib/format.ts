import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CaptureStillRunningError, CapturezeApiError, CapturezeTimeoutError } from './errors.ts';
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
 * The API returns the stored capture either as an absolute URL (user's own S3)
 * or as a path relative to the platform origin, and which field carries it
 * depends on the endpoint. Normalise to one absolute URL.
 */
export function resolveCaptureUrl(screenshot: Screenshot, baseUrl: string): string | null {
  const candidate =
    screenshot.url ??
    screenshot.storage_url ??
    (screenshot.file_path ? `/screenshots/${screenshot.file_path}` : null);
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

/** The API's viewport presets; a site stored with bare dimensions that equal one is that preset. */
const VIEWPORT_PRESETS: Record<string, { width: number; height: number }> = {
  desktop: { width: 1920, height: 1080 },
  laptop: { width: 1366, height: 768 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

function describeViewport(schedule: Schedule): string {
  if (schedule.viewport_preset && schedule.viewport_preset !== 'custom') return schedule.viewport_preset;
  const width = schedule.width ?? 1920;
  const height = schedule.height ?? 1080;
  if (!schedule.viewport_preset) {
    const preset = Object.entries(VIEWPORT_PRESETS).find(
      ([, size]) => size.width === width && size.height === height,
    );
    if (preset) return preset[0];
  }
  return `${width}x${height}`;
}

/**
 * The one shape a site leaves this server in, from every tool. An explicit
 * allow-list: the API row also carries the owner's id, stored credentials
 * (`auth_config`, `custom_headers`), injected scripts and notification
 * addresses, none of which belongs in a model's context.
 */
export function describeSchedule(schedule: Schedule): Record<string, unknown> {
  const recipe = schedule.capture_recipe ?? 'single';
  return {
    id: schedule.id,
    name: schedule.name,
    url: schedule.url,
    cron_expression: schedule.cron_expression,
    timezone: schedule.timezone ?? null,
    monitoring_active: schedule.is_active ?? false,
    viewport: describeViewport(schedule),
    full_page: schedule.full_page ?? false,
    output_format: schedule.output_format ?? 'png',
    geo: schedule.geo_country ? [schedule.geo_city, schedule.geo_country].filter(Boolean).join(', ') : null,
    capture_recipe: recipe,
    recipe_config: recipe === 'consent_flow' ? describeRecipeConfig(schedule.recipe_config) : null,
    dismiss_cookie_banners: schedule.dismiss_cookie_banners ?? false,
    wait_for_selector: schedule.wait_for_selector ?? null,
    hide_selectors: schedule.hide_selectors ?? [],
    diff_threshold: schedule.diff_threshold ?? null,
    notify_on_diff: typeof schedule.notify_on_diff === 'boolean' ? schedule.notify_on_diff : null,
    created_at: schedule.created_at ?? null,
    last_capture_at: schedule.latest_screenshot?.created_at ?? null,
    last_diff_percent: schedule.latest_screenshot?.diff_percent ?? null,
  };
}

/** consent_flow settings, by name: selectors and timings only. */
function describeRecipeConfig(config: unknown): Record<string, unknown> | null {
  if (!config || typeof config !== 'object') return null;
  const source = config as Record<string, unknown>;
  const allowed = ['accept_selector', 'reject_selector', 'wait_after_click_ms', 'interaction_timeout_ms'];
  return Object.fromEntries(
    allowed.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );
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
    // consent_flow frames share a session_group; `stage` says which one this
    // is (pre_consent, post_accept, post_reject). 'single' otherwise.
    stage: typeof screenshot.state === 'string' ? screenshot.state : 'single',
    session_group: screenshot.session_group ?? null,
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
    jsonBlock(describeCapture(screenshot, baseUrl)),
  ]
    .filter((line) => line !== '')
    .join('\n');
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
