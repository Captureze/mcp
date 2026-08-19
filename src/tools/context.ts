import type { CapturezeClient } from '../lib/client.ts';
import type { ServerConfig } from '../lib/config.ts';

export interface ToolContext {
  client: CapturezeClient;
  config: ServerConfig;
}
