import { CapturezeApiError, CapturezeTimeoutError } from './errors.ts';
import type { ServerConfig } from './config.ts';
import type {
  BillingInfo,
  CaptureCertificate,
  ConsentDetectionResponse,
  DiffTrendPoint,
  Execution,
  Schedule,
  ScheduleInput,
  Screenshot,
  ScreenshotComparison,
} from './types.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export interface DownloadedImage {
  data: string;
  mimeType: string;
  bytes: number;
  url: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/**
 * Thin typed wrapper over the Captureze REST API (`/api`, `Authorization:
 * Bearer cap_...`). It deliberately does no caching: an agent asking twice
 * usually means the world may have changed between the two calls.
 */
export class CapturezeClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  static fromConfig(config: ServerConfig, apiKey: string, fetchImpl?: FetchLike): CapturezeClient {
    return new CapturezeClient({
      baseUrl: config.baseUrl,
      apiKey,
      timeoutMs: config.timeoutMs,
      fetchImpl,
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CapturezeTimeoutError(this.timeoutMs, path);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }

    if (!response.ok) {
      const payload = (parsed ?? {}) as Record<string, unknown>;
      const message =
        typeof payload.error === 'string' ? payload.error : text.slice(0, 300) || `${method} ${path} failed`;
      throw new CapturezeApiError(
        response.status,
        message,
        typeof payload.code === 'string' ? payload.code : undefined,
        payload,
      );
    }

    return parsed as T;
  }

  // ---- sites (schedules) -------------------------------------------------

  listSchedules(): Promise<Schedule[]> {
    return this.request<Schedule[]>('GET', '/schedules');
  }

  getSchedule(id: string): Promise<Schedule> {
    return this.request<Schedule>('GET', `/schedules/${encodeURIComponent(id)}`);
  }

  createSchedule(input: ScheduleInput): Promise<Schedule> {
    return this.request<Schedule>('POST', '/schedules', input);
  }

  updateSchedule(id: string, input: Partial<ScheduleInput>): Promise<Schedule> {
    return this.request<Schedule>('PUT', `/schedules/${encodeURIComponent(id)}`, input);
  }

  deleteSchedule(id: string): Promise<void> {
    return this.request<void>('DELETE', `/schedules/${encodeURIComponent(id)}`);
  }

  // ---- captures ----------------------------------------------------------

  capture(scheduleId: string): Promise<Screenshot> {
    return this.request<Screenshot>('POST', `/schedules/${encodeURIComponent(scheduleId)}/capture`);
  }

  listScreenshots(scheduleId: string, limit = 10): Promise<Screenshot[]> {
    return this.request<Screenshot[]>(
      'GET',
      `/schedules/${encodeURIComponent(scheduleId)}/screenshots`,
      undefined,
      { limit },
    );
  }

  listExecutions(scheduleId: string, limit = 20): Promise<Execution[]> {
    return this.request<Execution[]>(
      'GET',
      `/schedules/${encodeURIComponent(scheduleId)}/executions`,
      undefined,
      { limit },
    );
  }

  // ---- diffs -------------------------------------------------------------

  compareScreenshots(screenshotId1: string, screenshotId2: string): Promise<ScreenshotComparison> {
    return this.request<ScreenshotComparison>('POST', '/screenshots/compare', {
      screenshotId1,
      screenshotId2,
    });
  }

  diffTrend(scheduleId: string): Promise<{ trend: DiffTrendPoint[] }> {
    return this.request<{ trend: DiffTrendPoint[] }>(
      'GET',
      `/schedules/${encodeURIComponent(scheduleId)}/diff-trend`,
    );
  }

  // ---- evidence ----------------------------------------------------------

  getCertificate(screenshotId: string): Promise<CaptureCertificate> {
    return this.request<CaptureCertificate>('GET', `/certificates/${encodeURIComponent(screenshotId)}/data`);
  }

  // ---- GDPR consent vertical --------------------------------------------

  detectConsent(input: {
    url: string;
    geo_country?: string;
    geo_city?: string;
  }): Promise<ConsentDetectionResponse> {
    return this.request<ConsentDetectionResponse>('POST', '/consent/detect', input);
  }

  getConsentDetection(jobId: string): Promise<ConsentDetectionResponse> {
    return this.request<ConsentDetectionResponse>('GET', `/consent/detect/${encodeURIComponent(jobId)}`);
  }

  // ---- account -----------------------------------------------------------

  getBilling(): Promise<BillingInfo> {
    return this.request<BillingInfo>('GET', '/billing');
  }

  validateCron(expression: string): Promise<{ valid: boolean; error?: string; description?: string }> {
    return this.request('POST', '/validate-cron', { cron_expression: expression });
  }

  viewportPresets(): Promise<Record<string, { width: number; height: number }>> {
    return this.request('GET', '/viewport-presets');
  }

  // ---- binary ------------------------------------------------------------

  /**
   * Downloads a stored capture. Screenshots live either on the platform origin
   * (`/screenshots/<path>`) or on the user's own S3 bucket (absolute URL), so
   * both shapes have to resolve. Only http(s) is allowed — the URL comes from
   * the API, but it is still user-controlled data (custom S3 endpoint).
   */
  async downloadImage(urlOrPath: string): Promise<DownloadedImage> {
    const absolute = new URL(urlOrPath, `${this.baseUrl}/`);
    if (absolute.protocol !== 'https:' && absolute.protocol !== 'http:') {
      throw new Error(`Refusing to download a capture over ${absolute.protocol}`);
    }

    const sameOrigin = absolute.origin === new URL(this.baseUrl).origin;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(absolute.toString(), {
        // Platform storage is public; the user's own bucket must not receive
        // the Captureze API key.
        headers: sameOrigin ? { Authorization: `Bearer ${this.apiKey}` } : {},
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CapturezeTimeoutError(this.timeoutMs, absolute.pathname);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new CapturezeApiError(
        response.status,
        `Could not download the capture from ${absolute.toString()}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const headerType = response.headers.get('content-type')?.split(';')[0]?.trim();
    const extension = absolute.pathname.split('.').pop()?.toLowerCase() ?? '';
    const mimeType =
      headerType && headerType !== 'application/octet-stream'
        ? headerType
        : (MIME_BY_EXTENSION[extension] ?? 'image/png');

    return {
      data: buffer.toString('base64'),
      mimeType,
      bytes: buffer.byteLength,
      url: absolute.toString(),
    };
  }
}
