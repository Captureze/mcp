import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Logger } from '../utils/logger.util.js';
import { formatErrorForMcpTool } from '../utils/error.util.js';
import * as captureController from '../controllers/capture.controller.js';

const logger = Logger.forContext('tools/capture.tool.ts');

const CreateCaptureArgs = z.object({
  url: z.string().url().describe('The URL of the page to capture'),
  width: z.number().int().positive().optional().describe('Viewport width in pixels (default: 1280)'),
  height: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Viewport height in pixels (default: 800)'),
  fullPage: z.boolean().optional().describe('Capture the full scrollable page (default: false)'),
  format: z
    .enum(['png', 'jpeg', 'webp', 'pdf'])
    .optional()
    .describe('Output image format (default: png)'),
  blockAds: z.boolean().optional().describe('Block ads and trackers (default: false)'),
  blockCookieBanners: z
    .boolean()
    .optional()
    .describe('Block cookie consent banners (default: false)'),
  delay: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Milliseconds to wait before capturing (default: 0)'),
});

const ListCapturesArgs = z.object({
  page: z.number().int().positive().optional().describe('Page number (default: 1)'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Number of results per page (default: 20)'),
});

const GetCaptureArgs = z.object({
  id: z.string().describe('The capture ID to retrieve'),
});

export function register(server: McpServer) {
  server.tool(
    'create_capture',
    `Takes a screenshot of the given URL using the Captureze API.
Returns capture details including status and, once completed, the image URL.`,
    CreateCaptureArgs.shape,
    async (args) => {
      try {
        logger.debug('Tool create_capture called', args);
        const result = await captureController.createCapture(args);
        return { content: [{ type: 'text' as const, text: result.content }] };
      } catch (error) {
        logger.error('Tool create_capture failed', error);
        return formatErrorForMcpTool(error);
      }
    },
  );

  server.tool(
    'list_captures',
    `Lists recent screenshot captures for the authenticated Captureze account.
Supports pagination via \`page\` and \`limit\` parameters.`,
    ListCapturesArgs.shape,
    async (args) => {
      try {
        logger.debug('Tool list_captures called', args);
        const result = await captureController.listCaptures(args);
        return { content: [{ type: 'text' as const, text: result.content }] };
      } catch (error) {
        logger.error('Tool list_captures failed', error);
        return formatErrorForMcpTool(error);
      }
    },
  );

  server.tool(
    'get_capture',
    `Retrieves details of a specific Captureze capture by its ID.`,
    GetCaptureArgs.shape,
    async (args) => {
      try {
        logger.debug('Tool get_capture called', args);
        const result = await captureController.getCapture(args);
        return { content: [{ type: 'text' as const, text: result.content }] };
      } catch (error) {
        logger.error('Tool get_capture failed', error);
        return formatErrorForMcpTool(error);
      }
    },
  );
}
