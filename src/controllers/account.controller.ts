import { Logger } from '../utils/logger.util.js';
import * as accountService from '../services/account.service.js';
import { formatAccount } from '../utils/formatter.util.js';
import { handleControllerError } from '../utils/error.util.js';
import type { ControllerResponse } from '../types/common.types.js';

const logger = Logger.forContext('controllers/account.controller.ts');

export async function getAccount(): Promise<ControllerResponse> {
  try {
    logger.debug('Getting account info');
    const account = await accountService.getAccount();
    return { content: formatAccount(account) };
  } catch (error) {
    throw handleControllerError(error, {
      entityType: 'Account',
      operation: 'get',
      source: 'controllers/account.controller.ts',
    });
  }
}
