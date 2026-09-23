import { randomUUID } from 'node:crypto';
import { CaptureStillRunningError, CapturezeApiError, CapturezeTimeoutError } from './errors.ts';
import type { ServerConfig } from './config.ts';
import type {
  BillingInfo,
  CaptureCertificate,
  ConsentDetectionResponse,
  DiffTrendPoint,
  Execution,
  ExecutionView,
  RunningExecution,
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
  /** Pause between long-polls of a running capture. */
  pollIntervalMs?: number;
}

export interface CaptureRequestOptions {
  /**
   * Ties retries to one capture: the API answers a repeat of this key with the
   * original capture instead of taking, and billing, another. Generated when
   * not given, so a timeout can still name the key to retry with.
   */
  idempotencyKey?: string;
}

export interface CaptureOutcome {
  screenshot: Screenshot;
  executionId: string | null;
  idempotencyKey: string;
  /**
   * `own`: this request's capture. `replayed`: an earlier request under the
   * same key. `joined`: another capture of the site that was already running —
   * its options may differ from the ones asked for.
   */
  source: 'own' | 'replayed' | 'joined';
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
  private readonly pollIntervalMs: number;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
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
    return (await this.send<T>(method, path, body, query)).body;
  }

  /**
   * One API call. Any status outside 2xx throws, except those listed in
   * `passStatuses`, which come back with their body for the caller to read.
   */
  private async send<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
    extraHeaders: Record<string, string> = {},
    passStatuses: number[] = [],
  ): Promise<{ status: number; body: T }> {
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
          ...extraHeaders,
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

    if (response.status === 204) return { status: 204, body: undefined as T };

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }

    if (!response.ok && !passStatuses.includes(response.status)) {
      throw apiError(response.status, parsed, text.slice(0, 300) || `${method} ${path} failed`);
    }

    return { status: response.status, body: parsed as T };
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

  /**
   * Runs one capture of a site. `overrides` vary the capture options for this
   * call only — the stored site is not modified — which is how "capture this
   * page from Germany" works on a URL the account already tracks. Omitted when
   * empty so a plain capture keeps using the site's own settings.
   */
  async capture(scheduleId: string, overrides?: Partial<ScheduleInput>): Promise<Screenshot> {
    return (await this.captureWithOutcome(scheduleId, overrides)).screenshot;
  }

  /**
   * Starts the capture in async mode and polls it, rather than holding one
   * request open for up to a minute. Whatever happens to this call, the
   * capture has an id and a key it can be found by.
   *
   * An API that predates async mode ignores `async` and answers 200 with the
   * capture, which is taken as is.
   */
  async captureWithOutcome(
    scheduleId: string,
    overrides?: Partial<ScheduleInput>,
    options: CaptureRequestOptions = {},
  ): Promise<CaptureOutcome> {
    const idempotencyKey = options.idempotencyKey ?? randomUUID();
    const deadline = Date.now() + this.timeoutMs;
    const body = overrides && Object.keys(overrides).length > 0 ? overrides : undefined;

    const started = await this.send<Screenshot | RunningExecution>(
      'POST',
      `/schedules/${encodeURIComponent(scheduleId)}/capture`,
      body,
      { async: 'true' },
      { 'Idempotency-Key': idempotencyKey },
      [409],
    );

    if (started.status === 409) {
      const running = started.body as RunningExecution;
      if (running.code !== 'CAPTURE_IN_PROGRESS' || !running.execution_id) {
        throw apiError(409, running, 'Capture refused');
      }
      const screenshot = await this.waitForCapture(
        running.execution_id,
        scheduleId,
        idempotencyKey,
        deadline,
      );
      return { screenshot, executionId: running.execution_id, idempotencyKey, source: 'joined' };
    }

    if (started.status === 202) {
      const running = started.body as RunningExecution;
      const screenshot = await this.waitForCapture(
        running.execution_id,
        scheduleId,
        idempotencyKey,
        deadline,
      );
      return { screenshot, executionId: running.execution_id, idempotencyKey, source: 'own' };
    }

    // 200: the capture itself — replayed under this key, or from an API
    // without async mode.
    return {
      screenshot: started.body as Screenshot,
      executionId: null,
      idempotencyKey,
      source: options.idempotencyKey ? 'replayed' : 'own',
    };
  }

  /**
   * `waitSeconds` long-polls: the API holds the request until the execution
   * finishes or the wait runs out (it caps it at 25). Each poll counts against
   * the hourly rate limit, so a capture should cost a request or two, not one
   * every couple of seconds.
   */
  getExecution(executionId: string, waitSeconds = 0): Promise<ExecutionView> {
    return this.request<ExecutionView>(
      'GET',
      `/executions/${encodeURIComponent(executionId)}`,
      undefined,
      waitSeconds > 0 ? { wait: waitSeconds } : undefined,
    );
  }

  /**
   * Polls a running capture until it finishes, then returns — or throws —
   * exactly what the capture request would have.
   */
  private async waitForCapture(
    executionId: string,
    scheduleId: string,
    idempotencyKey: string,
    deadline: number,
  ): Promise<Screenshot> {
    for (;;) {
      const remainingSeconds = Math.floor((deadline - Date.now()) / 1000);
      const execution = await this.getExecution(executionId, Math.min(25, Math.max(remainingSeconds - 1, 0)));
      if (execution.status !== 'running') {
        const response = execution.response;
        if (!response) {
          throw new CapturezeApiError(
            502,
            execution.error ?? `Capture ${executionId} finished without a result.`,
            undefined,
            execution as unknown as Record<string, unknown>,
          );
        }
        if (response.status >= 200 && response.status < 300) return response.body as Screenshot;
        throw apiError(response.status, response.body, `Capture ${executionId} failed`);
      }
      if (Date.now() + this.pollIntervalMs > deadline) {
        throw new CaptureStillRunningError({
          timeoutMs: this.timeoutMs,
          executionId,
          scheduleId,
          idempotencyKey,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
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

function apiError(status: number, parsed: unknown, fallback: string): CapturezeApiError {
  const payload = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  return new CapturezeApiError(
    status,
    typeof payload.error === 'string' ? payload.error : fallback,
    typeof payload.code === 'string' ? payload.code : undefined,
    payload,
  );
}
