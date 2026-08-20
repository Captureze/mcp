/**
 * Runtime configuration.
 *
 * Two deployment shapes are supported and they differ only in where the API key
 * comes from:
 *
 *  - stdio  — one process per user, key from CAPTUREZE_API_KEY.
 *  - http   — one process for many users, key from the Authorization header of
 *             each request (env key, if set, is the fallback for single-tenant
 *             deployments).
 */

export interface ServerConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  /** Max bytes of image data returned inline to the model. */
  maxInlineImageBytes: number;
}

const DEFAULT_BASE_URL = 'https://captureze.com';
const DEFAULT_TIMEOUT_MS = 180_000;
/** Roughly 6 MB of base64 — above this most clients choke on the message. */
const DEFAULT_MAX_INLINE_IMAGE_BYTES = 4_500_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawBase = env.CAPTUREZE_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return {
    // Trailing slashes make every later join ambiguous; normalise once, here.
    baseUrl: rawBase.replace(/\/+$/, ''),
    apiKey: env.CAPTUREZE_API_KEY?.trim() || undefined,
    timeoutMs: parsePositiveInt(env.CAPTUREZE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxInlineImageBytes: parsePositiveInt(
      env.CAPTUREZE_MAX_INLINE_IMAGE_BYTES,
      DEFAULT_MAX_INLINE_IMAGE_BYTES,
    ),
  };
}
