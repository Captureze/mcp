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
  /** Present on the list endpoint, which joins the newest capture. */
  last_screenshot_url?: string | null;
  last_screenshot_at?: string | null;
  last_diff_percent?: number | null;
  [key: string]: unknown;
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
  [key: string]: unknown;
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
  [key: string]: unknown;
}

export interface ConsentDetectionResponse {
  cached?: boolean;
  job_id?: string;
  status?: string;
  result?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface BillingInfo {
  plan?: string;
  isTrial?: boolean;
  limits?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}
