import axios, { type AxiosInstance } from 'axios';
import { handleApiError } from '../utils/error.util.js';
import { Logger } from '../utils/logger.util.js';

const logger = Logger.forContext('services/captureze-client.ts');

const DEFAULT_BASE_URL = 'https://api.captureze.com';

let _client: AxiosInstance | null = null;

export function getClient(): AxiosInstance {
  if (_client) return _client;

  const apiKey = process.env.CAPTUREZE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'CAPTUREZE_API_KEY environment variable is not set. ' +
        'Please set it to your Captureze API key.',
    );
  }

  const baseURL = process.env.CAPTUREZE_API_BASE_URL ?? DEFAULT_BASE_URL;
  logger.debug('Creating Captureze API client', { baseURL });

  _client = axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: 30_000,
  });

  _client.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      handleApiError(error, 'captureze-client');
    },
  );

  return _client;
}

/** Reset the singleton client (useful in tests). */
export function resetClient() {
  _client = null;
}
