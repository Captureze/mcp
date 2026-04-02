import { Logger } from '../utils/logger.util.js';
import * as captureService from '../services/capture.service.js';
import { formatCapture, formatCaptureList } from '../utils/formatter.util.js';
import { handleControllerError } from '../utils/error.util.js';
import type { ControllerResponse } from '../types/common.types.js';
import type { CaptureOptions } from '../types/capture.types.js';

const logger = Logger.forContext('controllers/capture.controller.ts');

export type CreateCaptureOptions = CaptureOptions;

export interface ListCapturesOptions {
  page?: number;
  limit?: number;
}

export interface GetCaptureOptions {
  id: string;
}

export async function createCapture(options: CreateCaptureOptions): Promise<ControllerResponse> {
  try {
    logger.debug('Creating capture', options);
    const capture = await captureService.createCapture(options);
    return { content: formatCapture(capture) };
  } catch (error) {
    throw handleControllerError(error, {
      entityType: 'Capture',
      operation: 'create',
      source: 'controllers/capture.controller.ts',
    });
  }
}

export async function listCaptures(options: ListCapturesOptions = {}): Promise<ControllerResponse> {
  try {
    logger.debug('Listing captures', options);
    const result = await captureService.listCaptures({ page: options.page, limit: options.limit });
    return { content: formatCaptureList(result) };
  } catch (error) {
    throw handleControllerError(error, {
      entityType: 'Capture',
      operation: 'list',
      source: 'controllers/capture.controller.ts',
    });
  }
}

export async function getCapture(options: GetCaptureOptions): Promise<ControllerResponse> {
  try {
    logger.debug('Getting capture', options);
    const capture = await captureService.getCapture(options.id);
    return { content: formatCapture(capture) };
  } catch (error) {
    throw handleControllerError(error, {
      entityType: 'Capture',
      operation: 'get',
      source: 'controllers/capture.controller.ts',
    });
  }
}
