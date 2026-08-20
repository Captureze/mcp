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
