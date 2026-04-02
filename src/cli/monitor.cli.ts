import { program } from 'commander';
import { Logger } from '../utils/logger.util.js';
import * as monitorController from '../controllers/monitor.controller.js';
import { handleCliError } from '../utils/error.util.js';

const logger = Logger.forContext('cli/monitor.cli.ts');

program
  .command('list-monitors')
  .description('List all monitors')
  .option('--page <number>', 'Page number', parseInt)
  .option('--limit <number>', 'Results per page', parseInt)
  .action(async (options) => {
    try {
      logger.debug('CLI list-monitors called', options);
      const result = await monitorController.listMonitors(options);
      console.log(result.content);
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command('get-monitor')
  .description('Get details of a specific monitor')
  .requiredOption('--id <id>', 'Monitor ID')
  .action(async (options) => {
    try {
      logger.debug('CLI get-monitor called', options);
      const result = await monitorController.getMonitor({ id: options.id });
      console.log(result.content);
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command('create-monitor')
  .description('Create a new visual-change monitor')
  .requiredOption('--name <name>', 'Monitor name')
  .requiredOption('--url <url>', 'URL to monitor')
  .option(
    '--interval <interval>',
    'Capture interval: fifteen_minutes, hourly, daily, weekly',
    'daily',
  )
  .option('--notify-on-change', 'Send notification on visual change', true)
  .action(async (options) => {
    try {
      logger.debug('CLI create-monitor called', options);
      const result = await monitorController.createMonitor({
        name: options.name,
        url: options.url,
        interval: options.interval,
        notifyOnChange: options.notifyOnChange,
      });
      console.log(result.content);
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command('delete-monitor')
  .description('Delete a monitor')
  .requiredOption('--id <id>', 'Monitor ID')
  .action(async (options) => {
    try {
      logger.debug('CLI delete-monitor called', options);
      const result = await monitorController.deleteMonitor({ id: options.id });
      console.log(result.content);
    } catch (error) {
      handleCliError(error);
    }
  });
