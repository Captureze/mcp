import { program } from 'commander';
import { Logger } from '../utils/logger.util.js';
import * as captureController from '../controllers/capture.controller.js';
import { handleCliError } from '../utils/error.util.js';

const logger = Logger.forContext('cli/capture.cli.ts');

program
  .command('create-capture')
  .description('Take a screenshot of a URL')
  .requiredOption('--url <url>', 'URL to capture')
  .option('--width <number>', 'Viewport width in pixels', parseInt)
  .option('--height <number>', 'Viewport height in pixels', parseInt)
  .option('--full-page', 'Capture the full scrollable page', false)
  .option('--format <format>', 'Output format: png, jpeg, webp, pdf', 'png')
  .option('--block-ads', 'Block ads and trackers', false)
  .option('--block-cookie-banners', 'Block cookie consent banners', false)
  .option('--delay <ms>', 'Milliseconds to wait before capturing', parseInt)
  .action(async (options) => {
    try {
      logger.debug('CLI create-capture called', options);
      const result = await captureController.createCapture({
        url: options.url,
        width: options.width,
        height: options.height,
        fullPage: options.fullPage,
        format: options.format,
        blockAds: options.blockAds,
        blockCookieBanners: options.blockCookieBanners,
        delay: options.delay,
      });
      console.log(result.content);
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command('list-captures')
  .description('List recent captures')
  .option('--page <number>', 'Page number', parseInt)
  .option('--limit <number>', 'Results per page', parseInt)
  .action(async (options) => {
    try {
      logger.debug('CLI list-captures called', options);
      const result = await captureController.listCaptures(options);
      console.log(result.content);
    } catch (error) {
      handleCliError(error);
    }
  });

program
  .command('get-capture')
  .description('Get details of a specific capture')
  .requiredOption('--id <id>', 'Capture ID')
  .action(async (options) => {
    try {
      logger.debug('CLI get-capture called', options);
      const result = await captureController.getCapture({ id: options.id });
      console.log(result.content);
    } catch (error) {
      handleCliError(error);
    }
  });
