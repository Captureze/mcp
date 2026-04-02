import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Logger } from '../utils/logger.util.js';
import { formatErrorForMcpTool } from '../utils/error.util.js';
import * as accountController from '../controllers/account.controller.js';

const logger = Logger.forContext('tools/account.tool.ts');

const GetAccountArgs = z.object({});

export function register(server: McpServer) {
  server.tool(
    'get_account',
    `Retrieves account information and API usage statistics for the authenticated Captureze account.
Returns the plan name, number of captures used/available, and monitors used/available.`,
    GetAccountArgs.shape,
    async (args) => {
      try {
        logger.debug('Tool get_account called', args);
        const result = await accountController.getAccount();
        return { content: [{ type: 'text' as const, text: result.content }] };
      } catch (error) {
        logger.error('Tool get_account failed', error);
        return formatErrorForMcpTool(error);
      }
    },
  );
}
