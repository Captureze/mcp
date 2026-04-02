import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Logger } from '../utils/logger.util.js';
import { formatErrorForMcpTool } from '../utils/error.util.js';
import * as monitorController from '../controllers/monitor.controller.js';

const logger = Logger.forContext('tools/monitor.tool.ts');

const ListMonitorsArgs = z.object({
  page: z.number().int().positive().optional().describe('Page number (default: 1)'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Number of results per page (default: 20)'),
});

const GetMonitorArgs = z.object({
  id: z.string().describe('The monitor ID to retrieve'),
});

const CreateMonitorArgs = z.object({
  name: z.string().describe('Human-readable name for the monitor'),
  url: z.string().url().describe('The URL to monitor for visual changes'),
  interval: z
    .enum(['fifteen_minutes', 'hourly', 'daily', 'weekly'])
    .optional()
    .describe('How often to capture the page (default: daily)'),
  notifyOnChange: z
    .boolean()
    .optional()
    .describe('Send a notification when a visual change is detected (default: true)'),
});

const DeleteMonitorArgs = z.object({
  id: z.string().describe('The monitor ID to delete'),
});

export function register(server: McpServer) {
  server.tool(
    'list_monitors',
    `Lists all visual-change monitors for the authenticated Captureze account.
Supports pagination via \`page\` and \`limit\` parameters.`,
    ListMonitorsArgs.shape,
    async (args) => {
      try {
        logger.debug('Tool list_monitors called', args);
        const result = await monitorController.listMonitors(args);
        return { content: [{ type: 'text' as const, text: result.content }] };
      } catch (error) {
        logger.error('Tool list_monitors failed', error);
        return formatErrorForMcpTool(error);
      }
    },
  );

  server.tool(
    'get_monitor',
    `Retrieves details of a specific Captureze monitor by its ID.`,
    GetMonitorArgs.shape,
    async (args) => {
      try {
        logger.debug('Tool get_monitor called', args);
        const result = await monitorController.getMonitor(args);
        return { content: [{ type: 'text' as const, text: result.content }] };
      } catch (error) {
        logger.error('Tool get_monitor failed', error);
        return formatErrorForMcpTool(error);
      }
    },
  );

  server.tool(
    'create_monitor',
    `Creates a new visual-change monitor on Captureze.
The monitor will periodically capture the given URL and alert on visual changes.`,
    CreateMonitorArgs.shape,
    async (args) => {
      try {
        logger.debug('Tool create_monitor called', args);
        const result = await monitorController.createMonitor(args);
        return { content: [{ type: 'text' as const, text: result.content }] };
      } catch (error) {
        logger.error('Tool create_monitor failed', error);
        return formatErrorForMcpTool(error);
      }
    },
  );

  server.tool(
    'delete_monitor',
    `Deletes a Captureze monitor by its ID.`,
    DeleteMonitorArgs.shape,
    async (args) => {
      try {
        logger.debug('Tool delete_monitor called', args);
        const result = await monitorController.deleteMonitor(args);
        return { content: [{ type: 'text' as const, text: result.content }] };
      } catch (error) {
        logger.error('Tool delete_monitor failed', error);
        return formatErrorForMcpTool(error);
      }
    },
  );
}
