#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';

// Register all CLI commands
import './capture.cli.js';
import './monitor.cli.js';
import './account.cli.js';

program
  .name('captureze-mcp')
  .description('Captureze MCP CLI – manage captures and monitors from the command line')
  .version('1.0.0');

program.parse(process.argv);
