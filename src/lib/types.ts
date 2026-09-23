/**
 * Shapes returned by the Captureze REST API. Only the fields the MCP surface
 * actually uses are typed; the API returns more and passes it through.
 */

export interface Schedule {
  id: string;
  name: string;
  url: string;
  cron_expression: string;
  timezone?: string | null;
  width?: number;
  height?: number;
  full_page?: boolean;
  is_active?: boolean;
  viewport_preset?: string | null;
  output_format?: string | null;
  diff_threshold?: number | null;
  geo_country?: string | null;
  geo_city?: string | null;
  capture_recipe?: string | null;
  dismiss_cookie_banners?: boolean | null;
  wait_for_selector?: string | null;
  hide_selectors?: string[] | null;
  created_at?: string;
  updated_at?: string;
  /**
   * The list endpoint (`GET /schedules`) joins the newest capture and the
   * newest run onto every row. Both are null for a site that has never been
   * captured, so `latest_screenshot: null` means "never", while a present
   * object with `diff_percent: null` means "captured once, nothing to diff".
   * The detail endpoint (`GET /schedules/:id`) returns the bare row and omits
   * both.
   */
  latest_screenshot?: ScheduleLatestScreenshot | null;
  latest_execution?: ScheduleLatestExecution | null;
  [key: string]: unknown;
}

export interface ScheduleLatestScreenshot {
  id: string;
  file_path?: string | null;
  file_size?: number | null;
  diff_percent?: number | null;
  url?: string | null;
  thumb_url?: string | null;
  diff_url?: string | null;
  created_at?: string | null;
  proxy_tier?: number | null;
}

export interface ScheduleLatestExecution {
  id: string;
  status?: string | null;
  error_message?: string | null;
  created_at?: string | null;
}

export interface ScheduleInput {
  name: string;
  url: string;
  cron_expression: string;
  timezone?: string;
  width?: number;
  height?: number;
  full_page?: boolean;
  is_active?: boolean;
  viewport_preset?: string;
  output_format?: string;
  diff_threshold?: number;
  notify_on_diff?: boolean;
  notify_on_error?: boolean;
  notify_on_success?: boolean;
  geo_country?: string;
  geo_city?: string;
  wait_for_selector?: string;
  hide_selectors?: string[];
  dismiss_cookie_banners?: boolean;
  capture_recipe?: string;
  recipe_config?: Record<string, unknown>;
  /**
   * Whether the API should take its own first screenshot on creation.
   * Defaults to true server-side for the dashboard, which relies on it; every
   * caller in this server captures explicitly and so opts out.
   */
  capture_now?: boolean;
  [key: string]: unknown;
}

export interface Screenshot {
  id: string;
  schedule_id: string;
  file_path: string;
  file_size?: number | null;
  storage_url?: string | null;
  thumbnail_url?: string | null;
  diff_image_url?: string | null;
  diff_percent?: number | null;
  baseline_screenshot_id?: string | null;
  proxy_tier?: number | null;
  session_group?: string | null;
  frame_count?: number | null;
  created_at?: string;
  /** Only the list endpoint computes these aliases. */
  url?: string | null;
  thumb_url?: string | null;
  diff_url?: string | null;
  /**
   * Present on a capture response. Says whether the country the caller asked
   * for was actually the country the capture came from, measured from the
   * proxy exit rather than taken from the provider's label.
   */
  geo_verification?: GeoVerification | null;
  [key: string]: unknown;
}

export interface GeoVerification {
  /** not_requested | confirmed | mismatch | unverified | not_recorded */
  status: string;
  requested_country?: string | null;
  observed_country?: string | null;
  /** False for both a wrong country and one that could not be measured. */
  honoured?: boolean;
  detail?: string;
}

export interface Execution {
  id: string;
  schedule_id: string;
  status: string;
  started_at?: string;
  completed_at?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
  screenshot_id?: string | null;
  [key: string]: unknown;
}

/** A capture that has started and not finished: 202, or 409 CAPTURE_IN_PROGRESS. */
export interface RunningExecution {
  execution_id: string;
  schedule_id?: string;
  status?: string;
  started_at?: string;
  poll_url?: string;
  code?: string;
  error?: string;
  [key: string]: unknown;
}

/** GET /api/executions/:id */
export interface ExecutionView {
  execution_id: string;
  schedule_id: string;
  status: string;
  capture_id?: string | null;
  error?: string | null;
  /** What the capture request returned; absent while running. */
  response?: { status: number; body: unknown } | null;
  [key: string]: unknown;
}

export interface ScreenshotComparison {
  diffPercent?: number;
  diff_percent?: number;
  [key: string]: unknown;
}

export interface DiffTrendPoint {
  id: string;
  diff_percent: number;
  created_at: string;
}

export interface CaptureCertificate {
  certificate_id: string;
  page_url: string;
  page_title?: string | null;
  captured_at?: string;
  http_status?: number | null;
  screenshot_sha256?: string | null;
  pdf_sha256?: string | null;
  viewport_width?: number | null;
  viewport_height?: number | null;
  device_type?: string | null;
  proxy_country?: string | null;
  proxy_city?: string | null;
  proxy_type?: string | null;
  storage_region?: string | null;
  privacy_mode?: boolean | null;
  has_pdf?: boolean;
  verify_url?: string;
  created_at?: string;
  /** RFC 3161 timestamp from an outside authority; null when the certificate has none. */
  timestamp?: CertificateTimestamp | null;
  [key: string]: unknown;
}

export interface CertificateTimestamp {
  standard: string;
  authority: string;
  time: string;
  serial: string;
  token_url: string;
}

export interface ConsentDetectionResponse {
  cached?: boolean;
  job_id?: string;
  status?: string;
  result?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/**
 * The plan and its trial state, as GET /api/billing nests them. Kept apart
 * from BillingInfo because the endpoint returns null here for an account with
 * no subscription row, which is the only case that has no plan to name.
 */
export interface BillingSubscription {
  plan?: string;
  status?: string;
  isTrial?: boolean;
  /** Trial over, no upgrade: the account is open but capture is paused. */
  isDormant?: boolean;
  trialDaysRemaining?: number | null;
  trialQuotaPlan?: string;
  [key: string]: unknown;
}

export interface BillingInfo {
  hasSubscription?: boolean;
  subscription?: BillingSubscription | null;
  limits?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  features?: unknown[];
  [key: string]: unknown;
}
