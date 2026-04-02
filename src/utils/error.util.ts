import axios from 'axios';

export class CapturezeApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CapturezeApiError';
  }
}

export function handleApiError(error: unknown, context: string): never {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    const message = (error.response?.data as { message?: string })?.message ?? error.message;
    throw new CapturezeApiError(status, `[${context}] ${message}`, error.response?.data);
  }
  if (error instanceof Error) {
    throw new CapturezeApiError(0, `[${context}] ${error.message}`);
  }
  throw new CapturezeApiError(0, `[${context}] Unknown error`);
}

export function formatErrorForMcpTool(error: unknown): { content: [{ type: 'text'; text: string }] } {
  let message: string;
  if (error instanceof CapturezeApiError) {
    message = `Error (${error.statusCode}): ${error.message}`;
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = 'An unknown error occurred';
  }
  return { content: [{ type: 'text' as const, text: message }] };
}

export function handleControllerError(
  error: unknown,
  meta: { entityType: string; operation: string; source: string },
): Error {
  const prefix = `[${meta.source}] ${meta.operation} ${meta.entityType} failed`;
  if (error instanceof CapturezeApiError) {
    return new CapturezeApiError(error.statusCode, `${prefix}: ${error.message}`, error.details);
  }
  if (error instanceof Error) {
    return new Error(`${prefix}: ${error.message}`);
  }
  return new Error(`${prefix}: Unknown error`);
}

export function handleCliError(error: unknown): never {
  if (error instanceof CapturezeApiError) {
    console.error(`Error (${error.statusCode}): ${error.message}`);
  } else if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error('An unknown error occurred');
  }
  process.exit(1);
}
