import { getClient } from './captureze-client.js';
import { Logger } from '../utils/logger.util.js';
import { handleApiError } from '../utils/error.util.js';
import type { Capture, CaptureListResult, CaptureOptions } from '../types/capture.types.js';
import type { PaginationParams } from '../types/common.types.js';

const logger = Logger.forContext('services/capture.service.ts');

/**
 * Request a new screenshot capture.
 */
export async function createCapture(options: CaptureOptions): Promise<Capture> {
  logger.debug('Creating capture', options);
  try {
    const response = await getClient().post<Capture>('/v1/captures', options);
    return response.data;
  } catch (error) {
    handleApiError(error, 'capture.service#createCapture');
  }
}

/**
 * List all captures for the authenticated account.
 */
export async function listCaptures(pagination: PaginationParams = {}): Promise<CaptureListResult> {
  logger.debug('Listing captures', pagination);
  try {
    const response = await getClient().get<CaptureListResult>('/v1/captures', {
      params: pagination,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, 'capture.service#listCaptures');
  }
}

/**
 * Get a single capture by ID.
 */
export async function getCapture(id: string): Promise<Capture> {
  logger.debug('Getting capture', { id });
  try {
    const response = await getClient().get<Capture>(`/v1/captures/${id}`);
    return response.data;
  } catch (error) {
    handleApiError(error, 'capture.service#getCapture');
  }
}
