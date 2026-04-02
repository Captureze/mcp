import { getClient } from './captureze-client.js';
import { Logger } from '../utils/logger.util.js';
import { handleApiError } from '../utils/error.util.js';
import type { Account } from '../types/account.types.js';

const logger = Logger.forContext('services/account.service.ts');

/**
 * Retrieve account and usage information for the authenticated user.
 */
export async function getAccount(): Promise<Account> {
  logger.debug('Getting account info');
  try {
    const response = await getClient().get<Account>('/v1/account');
    return response.data;
  } catch (error) {
    handleApiError(error, 'account.service#getAccount');
  }
}
