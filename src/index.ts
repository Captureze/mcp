#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Logger } from './utils/logger.util.js';
import * as captureTool from './tools/capture.tool.js';
import * as monitorTool from './tools/monitor.tool.js';
import * as accountTool from './tools/account.tool.js';

const logger = Logger.forContext('index.ts');

const server = new McpServer({
  name: 'captureze',
  version: '1.0.0',
  description: 'MCP server for the Captureze screenshot and visual-monitoring API',
});

function registerTools(srv: McpServer) {
  captureTool.register(srv);
  monitorTool.register(srv);
  accountTool.register(srv);
}

async function main() {
  logger.info('Starting Captureze MCP server');

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Captureze MCP server running on stdio');
}

main().catch((error: unknown) => {
  logger.error('Fatal error starting Captureze MCP server', error);
  process.exit(1);
});
