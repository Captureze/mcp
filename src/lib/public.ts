import type { BillingInfo, Execution, Schedule, Screenshot } from './types.ts';

/**
 * The shapes every tool answers with, each built field by field. Nothing from
 * the API is passed through as is: a field reaches a client only by being
 * written out here.
 */

export type CaptureStage = 'single' | 'pre_consent' | 'post_accept' | 'post_reject';

export interface PublicSite {
  id: string;
  name: string;
  url: string;
  cron_expression: string;
  /** The zone the cron runs in: the site's own, or the server default it falls back to. Never null. */
  timezone: string | null;
  monitoring_active: boolean;
  /** Preset name; with "custom", `width` and `height` say the size. */
  viewport: string;
  width?: number;
  height?: number;
  full_page: boolean;
  output_format: string | null;
  geo: { country: string; city: string | null } | null;
  capture_recipe: 'single' | 'consent_flow';
  /** consent_flow only: the selectors it clicks. */
  recipe_config: { accept_selector: string | null; reject_selector: string | null } | null;
  dismiss_cookie_banners: boolean;
  diff_threshold: number | null;
  notify_on_diff: boolean;
  /** Whether the site sends credentials, extra headers or a script. Their values are never returned. */
  has_auth: boolean;
  has_custom_headers: boolean;
  has_inject_script: boolean;
  last_capture_at: string | null;
  last_diff_percent: number | null;
}

export interface PublicCapture {
  capture_id: string;
  site_id: string;
  /** Which frame of a consent_flow capture this is; "single" for every other capture. */
  stage: CaptureStage;
  /** When the page was photographed — the same instant the certificate records. */
  captured_at: string | null;
  image_url: string | null;
  diff_image_url: string | null;
  /** Change against the previous capture of the same site and stage. */
  diff_percent: number | null;
  file_size_bytes: number | null;
  /** Shared by the frames of one consent_flow capture; null otherwise. */
  session_group: string | null;
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

/** Something is configured: not null, not an empty string, object or array. */
function isSet(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const STAGES = new Set<CaptureStage>(['pre_consent', 'post_accept', 'post_reject']);

export function captureStage(screenshot: object): CaptureStage {
  const state = (screenshot as { state?: unknown }).state;
  return STAGES.has(state as CaptureStage) ? (state as CaptureStage) : 'single';
}

export function toPublicSite(schedule: Schedule): PublicSite {
  const preset = stringOrNull(schedule.viewport_preset) ?? 'desktop';
  const isCustom = preset === 'custom';
  const recipe = schedule.capture_recipe === 'consent_flow' ? 'consent_flow' : 'single';
  const recipeConfig = (schedule.recipe_config ?? {}) as Record<string, unknown>;
  const latest = schedule.latest_screenshot ?? null;

  return {
    id: schedule.id,
    name: schedule.name,
    url: schedule.url,
    cron_expression: schedule.cron_expression,
    timezone: stringOrNull(schedule.effective_timezone) ?? stringOrNull(schedule.timezone),
    monitoring_active: schedule.is_active === true,
    viewport: preset,
    ...(isCustom
      ? { width: numberOrNull(schedule.width) ?? 1920, height: numberOrNull(schedule.height) ?? 1080 }
      : {}),
    full_page: schedule.full_page === true,
    output_format: stringOrNull(schedule.output_format),
    geo: schedule.geo_country
      ? { country: schedule.geo_country, city: stringOrNull(schedule.geo_city) }
      : null,
    capture_recipe: recipe,
    recipe_config:
      recipe === 'consent_flow'
        ? {
            accept_selector: stringOrNull(recipeConfig.accept_selector),
            reject_selector: stringOrNull(recipeConfig.reject_selector),
          }
        : null,
    dismiss_cookie_banners: schedule.dismiss_cookie_banners === true,
    diff_threshold: numberOrNull(schedule.diff_threshold),
    notify_on_diff: schedule.notify_on_diff === true,
    has_auth: isSet(schedule.auth_config),
    has_custom_headers: isSet(schedule.custom_headers),
    has_inject_script: isSet(schedule.inject_script),
    last_capture_at: latest ? (stringOrNull(latest.captured_at) ?? stringOrNull(latest.created_at)) : null,
    last_diff_percent: latest ? numberOrNull(latest.diff_percent) : null,
  };
}

export function toPublicCapture(screenshot: Screenshot, baseUrl: string): PublicCapture {
  return {
    capture_id: screenshot.id,
    site_id: screenshot.schedule_id,
    stage: captureStage(screenshot),
    captured_at: stringOrNull(screenshot.captured_at) ?? stringOrNull(screenshot.created_at),
    image_url: resolveCaptureUrl(screenshot, baseUrl),
    diff_image_url: resolveDiffUrl(screenshot, baseUrl),
    diff_percent: numberOrNull(screenshot.diff_percent),
    file_size_bytes: numberOrNull(screenshot.file_size),
    session_group: stringOrNull(screenshot.session_group),
  };
}

/** Newest capture first; sites never captured last, by name. */
export function bySiteRecency(a: PublicSite, b: PublicSite): number {
  if (a.last_capture_at && b.last_capture_at) {
    return Date.parse(b.last_capture_at) - Date.parse(a.last_capture_at);
  }
  if (a.last_capture_at) return -1;
  if (b.last_capture_at) return 1;
  return a.name.localeCompare(b.name);
}

export interface PublicRun {
  id: string;
  status: string;
  started_at: string | null;
  duration_ms: number | null;
  error: string | null;
  /** The first capture the run stored (pre_consent for a consent_flow run). */
  capture_id: string | null;
  /** Every capture the run stored, with its stage. */
  captures: { capture_id: string; stage: CaptureStage }[];
}

export function toPublicRun(run: Execution): PublicRun {
  const captures = Array.isArray(run.captures)
    ? (run.captures as { capture_id?: unknown; stage?: unknown }[])
        .filter((entry) => typeof entry?.capture_id === 'string')
        .map((entry) => ({
          capture_id: entry.capture_id as string,
          stage: captureStage({ state: entry.stage }),
        }))
    : [];
  return {
    id: run.id,
    status: run.status,
    started_at: stringOrNull(run.started_at) ?? stringOrNull(run.created_at),
    duration_ms: numberOrNull(run.duration_ms),
    error: stringOrNull(run.error_message),
    capture_id: stringOrNull(run.screenshot_id),
    captures,
  };
}

export interface PublicAccount {
  plan: string | null;
  status: string | null;
  is_trial: boolean;
  /** Trial over without an upgrade: the account is kept, capture is paused. */
  is_dormant: boolean;
  trial_days_remaining: number | null;
  trial_ends_at: string | null;
  /** Everything the plan unlocks, including what it inherits from lower plans. */
  features: { key: string; label: string }[] | null;
  limits: { sites: number | null; screenshots: number | null; min_interval_minutes: number | null };
  usage: { sites: number | null; screenshots: number | null };
  percentages: { sites: number | null; screenshots: number | null };
  /** Set once access has ended: when the stored captures will be deleted. */
  archive_deletes_on: string | null;
}

export function toPublicAccount(billing: BillingInfo): PublicAccount {
  const subscription = billing.subscription ?? null;
  const limits = (billing.limits ?? {}) as Record<string, unknown>;
  const usage = (billing.usage ?? {}) as Record<string, unknown>;
  const percentages = (billing.percentages ?? {}) as Record<string, unknown>;
  const entitlements = Array.isArray(billing.entitlements)
    ? (billing.entitlements as { key?: unknown; label?: unknown }[])
        .filter((entry) => typeof entry?.key === 'string')
        .map((entry) => ({ key: String(entry.key), label: String(entry.label ?? entry.key) }))
    : null;
  const archive = (billing.archive ?? null) as { deletesOn?: unknown } | null;

  return {
    plan: stringOrNull(subscription?.plan),
    status: stringOrNull(subscription?.status),
    is_trial: subscription?.isTrial === true,
    is_dormant: subscription?.isDormant === true,
    trial_days_remaining: subscription?.isTrial ? numberOrNull(subscription.trialDaysRemaining) : null,
    trial_ends_at: subscription?.isTrial ? stringOrNull(subscription.trialEndsAt) : null,
    features: entitlements,
    limits: {
      sites: numberOrNull(limits.sites),
      screenshots: numberOrNull(limits.screenshots),
      min_interval_minutes: numberOrNull(limits.min_interval_minutes),
    },
    usage: { sites: numberOrNull(usage.sites), screenshots: numberOrNull(usage.screenshots) },
    percentages: {
      sites: numberOrNull(percentages.sites),
      screenshots: numberOrNull(percentages.screenshots),
    },
    archive_deletes_on: archive ? stringOrNull(archive.deletesOn) : null,
  };
}

/** One site, read the way every tool reads it. */
export async function loadPublicSite(
  client: { getSchedule(id: string): Promise<Schedule> },
  siteId: string,
): Promise<PublicSite> {
  return toPublicSite(await client.getSchedule(siteId));
}

const CONSENT_RESULT_FIELDS = [
  'found',
  'cmp_id',
  'detection_method',
  'confidence',
  'accept',
  'reject',
  'candidates',
  'warnings',
  'banner_screenshot_url',
  'detected_at',
  'viewport',
] as const;

/**
 * The plain CSS part of a detection selector, for tools other than Captureze.
 * Detection selectors are Puppeteer selectors: `base::-p-text("label")` also
 * matches on the button's text, `host >>> inner` reaches into a shadow root.
 * The text match drops to `base` (which may match several elements; the
 * result's `text` names the one); a shadow-root selector has no CSS form.
 */
export function plainCssSelector(selector: unknown): string | null {
  if (typeof selector !== 'string' || selector.includes('>>>')) return null;
  const textMatch = /^(.*)::-p-text\((?:"[^"]*"|'[^']*'|[^)]*)\)$/s.exec(selector);
  const css = textMatch ? textMatch[1]!.trim() : selector;
  return css && !css.includes('::-p-') ? css : null;
}

function withCssSelector(control: unknown): unknown {
  if (!control || typeof control !== 'object' || !('selector' in control)) return control;
  return { ...control, css_selector: plainCssSelector((control as { selector: unknown }).selector) };
}

/** A banner detection result: what was found and where to click. */
export function toPublicConsentResult(
  result: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!result) return null;
  const out: Record<string, unknown> = {};
  for (const field of CONSENT_RESULT_FIELDS) {
    if (field in result) out[field] = result[field];
  }
  if ('accept' in out) out.accept = withCssSelector(out.accept);
  if ('reject' in out) out.reject = withCssSelector(out.reject);
  if (Array.isArray(out.candidates)) out.candidates = out.candidates.map(withCssSelector);
  return out;
}

export interface PublicGeo {
  requested_country: string | null;
  observed_country: string | null;
  country_status: string;
  requested_city: string | null;
  observed_city: string | null;
  /** confirmed | not_confirmed | unverified | not_requested */
  city_status: string;
}

/** Where a capture was asked to come from and where it was measured; null when the API did not say. */
export function toPublicGeo(screenshot: Screenshot): PublicGeo | null {
  const geo = screenshot.geo_verification;
  if (!geo) return null;
  return {
    requested_country: stringOrNull(geo.requested_country),
    observed_country: stringOrNull(geo.observed_country),
    country_status: geo.status,
    requested_city: stringOrNull(geo.requested_city),
    observed_city: stringOrNull(geo.observed_city),
    city_status: stringOrNull(geo.city_status) ?? 'not_requested',
  };
}
