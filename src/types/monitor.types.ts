/**
 * A monitor resource returned by the Captureze API.
 */
export interface Monitor {
  id: string;
  name: string;
  url: string;
  interval: 'fifteen_minutes' | 'hourly' | 'daily' | 'weekly';
  status: 'active' | 'paused';
  notifyOnChange?: boolean;
  lastCaptureAt?: string;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Parameters for creating a new monitor.
 */
export interface CreateMonitorOptions {
  name: string;
  url: string;
  interval?: 'fifteen_minutes' | 'hourly' | 'daily' | 'weekly';
  notifyOnChange?: boolean;
}

/**
 * Paginated list of monitors.
 */
export interface MonitorListResult {
  data: Monitor[];
  total: number;
  page: number;
  limit: number;
}
