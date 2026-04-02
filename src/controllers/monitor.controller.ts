import { Logger } from '../utils/logger.util.js';
import * as monitorService from '../services/monitor.service.js';
import { formatMonitor, formatMonitorList } from '../utils/formatter.util.js';
import { handleControllerError } from '../utils/error.util.js';
import type { ControllerResponse } from '../types/common.types.js';
import type { CreateMonitorOptions } from '../types/monitor.types.js';

const logger = Logger.forContext('controllers/monitor.controller.ts');

export interface ListMonitorsOptions {
  page?: number;
  limit?: number;
}

export interface GetMonitorOptions {
  id: string;
}

export interface DeleteMonitorOptions {
  id: string;
}

export async function listMonitors(options: ListMonitorsOptions = {}): Promise<ControllerResponse> {
  try {
    logger.debug('Listing monitors', options);
    const result = await monitorService.listMonitors({ page: options.page, limit: options.limit });
    return { content: formatMonitorList(result) };
  } catch (error) {
    throw handleControllerError(error, {
      entityType: 'Monitor',
      operation: 'list',
      source: 'controllers/monitor.controller.ts',
    });
  }
}

export async function getMonitor(options: GetMonitorOptions): Promise<ControllerResponse> {
  try {
    logger.debug('Getting monitor', options);
    const monitor = await monitorService.getMonitor(options.id);
    return { content: formatMonitor(monitor) };
  } catch (error) {
    throw handleControllerError(error, {
      entityType: 'Monitor',
      operation: 'get',
      source: 'controllers/monitor.controller.ts',
    });
  }
}

export async function createMonitor(
  options: CreateMonitorOptions,
): Promise<ControllerResponse> {
  try {
    logger.debug('Creating monitor', options);
    const monitor = await monitorService.createMonitor(options);
    return { content: formatMonitor(monitor) };
  } catch (error) {
    throw handleControllerError(error, {
      entityType: 'Monitor',
      operation: 'create',
      source: 'controllers/monitor.controller.ts',
    });
  }
}

export async function deleteMonitor(options: DeleteMonitorOptions): Promise<ControllerResponse> {
  try {
    logger.debug('Deleting monitor', options);
    await monitorService.deleteMonitor(options.id);
    return { content: `Monitor \`${options.id}\` deleted successfully.` };
  } catch (error) {
    throw handleControllerError(error, {
      entityType: 'Monitor',
      operation: 'delete',
      source: 'controllers/monitor.controller.ts',
    });
  }
}
