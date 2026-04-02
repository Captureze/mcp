import { program } from 'commander';
import { Logger } from '../utils/logger.util.js';
import * as accountController from '../controllers/account.controller.js';
import { handleCliError } from '../utils/error.util.js';

const logger = Logger.forContext('cli/account.cli.ts');

program
  .command('get-account')
  .description('Show account info and API usage')
  .action(async () => {
    try {
      logger.debug('CLI get-account called');
      const result = await accountController.getAccount();
      console.log(result.content);
    } catch (error) {
      handleCliError(error);
    }
  });
