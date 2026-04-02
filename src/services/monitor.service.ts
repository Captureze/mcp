import { getClient } from './captureze-client.js';
import { Logger } from '../utils/logger.util.js';
import { handleApiError } from '../utils/error.util.js';
import type {
  Monitor,
  MonitorListResult,
  CreateMonitorOptions,
} from '../types/monitor.types.js';
import type { PaginationParams } from '../types/common.types.js';

const logger = Logger.forContext('services/monitor.service.ts');

/**
 * List all monitors for the authenticated account.
 */
export async function listMonitors(pagination: PaginationParams = {}): Promise<MonitorListResult> {
  logger.debug('Listing monitors', pagination);
  try {
    const response = await getClient().get<MonitorListResult>('/v1/monitors', {
      params: pagination,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, 'monitor.service#listMonitors');
  }
}

/**
 * Get a single monitor by ID.
 */
export async function getMonitor(id: string): Promise<Monitor> {
  logger.debug('Getting monitor', { id });
  try {
    const response = await getClient().get<Monitor>(`/v1/monitors/${id}`);
    return response.data;
  } catch (error) {
    handleApiError(error, 'monitor.service#getMonitor');
  }
}

/**
 * Create a new monitor.
 */
export async function createMonitor(options: CreateMonitorOptions): Promise<Monitor> {
  logger.debug('Creating monitor', options);
  try {
    const response = await getClient().post<Monitor>('/v1/monitors', options);
    return response.data;
  } catch (error) {
    handleApiError(error, 'monitor.service#createMonitor');
  }
}

/**
 * Delete a monitor by ID.
 */
export async function deleteMonitor(id: string): Promise<void> {
  logger.debug('Deleting monitor', { id });
  try {
    await getClient().delete(`/v1/monitors/${id}`);
  } catch (error) {
    handleApiError(error, 'monitor.service#deleteMonitor');
  }
}
