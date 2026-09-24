/**
 * Errors the Captureze API can return, translated into something an agent can
 * act on. Plan limits (402) are the interesting case: the agent should stop
 * retrying and tell the user what to upgrade, not loop.
 */
export class CapturezeApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'CapturezeApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Guidance appended to the message so the model does not have to guess. */
  get hint(): string {
    switch (this.status) {
      case 401:
        return 'The Captureze API key is missing or invalid. Set CAPTUREZE_API_KEY (stdio) or send it as `Authorization: Bearer cap_...` (HTTP).';
      case 402:
        return "This account's plan does not cover the request. Report the limit to the user — do not retry.";
      case 403:
        return 'The API key is valid but not allowed to do this.';
      case 404:
        return 'No such object for this account. List sites first and use an id from that list.';
      case 429:
        return 'Rate limited. Wait before retrying; do not retry in a tight loop.';
      case 502:
        return 'The target site refused the capture (anti-bot protection, 403 or 429). This is the page pushing back, not a Captureze fault — retrying the same URL immediately will usually fail the same way.';
      case 503:
        return "Captureze's proxy pool is temporarily unavailable. This is our infrastructure, not the page. Wait and retry.";
      case 504:
        return 'The page took too long to capture. Heavy or full-page captures can exceed the budget — retry once, and consider capturing the viewport instead of the full page.';
      default:
        return this.status >= 500
          ? 'Captureze failed to serve the request. Retry once; if it fails again, report it.'
          : 'The request was rejected. Fix the arguments before retrying.';
    }
  }

  toString(): string {
    const code = this.code ? ` [${this.code}]` : '';
    return `Captureze API error ${this.status}${code}: ${this.message}\n${this.hint}`;
  }
}

export class CapturezeTimeoutError extends Error {
  constructor(timeoutMs: number, path: string) {
    super(
      `Captureze did not respond within ${Math.round(timeoutMs / 1000)}s (${path}). ` +
        'Captures run a real browser through a proxy and can be slow; the capture may still complete — ' +
        "check the site's capture history before retrying.",
    );
    this.name = 'CapturezeTimeoutError';
  }
}

/**
 * The capture outlived this call but was not lost: it runs to completion on
 * the server and is stored. Says how to collect it without paying twice.
 */
export class CaptureStillRunningError extends Error {
  readonly executionId: string;
  readonly scheduleId: string;
  readonly idempotencyKey: string;

  constructor({
    timeoutMs,
    executionId,
    scheduleId,
    idempotencyKey,
  }: {
    timeoutMs: number;
    executionId: string;
    scheduleId: string;
    idempotencyKey: string;
  }) {
    super(
      `The capture is still running after ${Math.round(timeoutMs / 1000)}s (execution ${executionId}, site ${scheduleId}). ` +
        'It will finish and be stored, and it is billed once. To get its result, call the same tool again with ' +
        `idempotency_key "${idempotencyKey}" — that returns this capture instead of taking a second one — ` +
        'or look it up with captureze_list_capture_runs. Do not retry without the key.',
    );
    this.name = 'CaptureStillRunningError';
    this.executionId = executionId;
    this.scheduleId = scheduleId;
    this.idempotencyKey = idempotencyKey;
  }
}
