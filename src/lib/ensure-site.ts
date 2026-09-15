import type { CapturezeClient } from './client.ts';
import type { Schedule, ScheduleInput } from './types.ts';
import { sameTarget, siteLabel } from './url.ts';

/**
 * Captureze stores every capture against a site (schedule row), so an ad-hoc
 * "screenshot this URL" still needs one. Rather than creating a throwaway site
 * per call — which would exhaust the account's site limit in a handful of agent
 * turns — an existing site for the same URL is reused, and a new one is created
 * paused (is_active false) so it never fires on its own.
 *
 * Daily is the coarsest preset and passes the interval check on every plan,
 * which is what a paused ad-hoc site wants.
 */
export const ADHOC_CRON = '0 3 * * *';

export interface EnsureSiteResult {
  schedule: Schedule;
  created: boolean;
}

export interface EnsureSiteOptions {
  client: CapturezeClient;
  url: string;
  settings?: Partial<ScheduleInput>;
  /** true keeps the site active on its cron; false creates it paused. */
  monitor?: boolean;
  cronExpression?: string;
  name?: string;
  /**
   * Whether the API should take its own first screenshot when it creates the
   * site. Callers that capture explicitly straight afterwards pass false, so
   * one request does not store two captures. Callers that only create a site
   * must leave this true, or the site has no baseline to diff the first
   * scheduled capture against.
   */
  captureOnCreate?: boolean;
}

export async function ensureSiteForUrl({
  client,
  url,
  settings = {},
  monitor = false,
  cronExpression,
  name,
  captureOnCreate = true,
}: EnsureSiteOptions): Promise<EnsureSiteResult> {
  const existing = await client.listSchedules();
  const match = existing.find((schedule) => sameTarget(schedule.url, url));
  if (match) return { schedule: match, created: false };

  const schedule = await client.createSchedule({
    name: name ?? siteLabel(url),
    url,
    cron_expression: cronExpression ?? ADHOC_CRON,
    is_active: monitor,
    ...settings,
    // The API takes a detached first screenshot when a site is created. A
    // caller that captures explicitly straight afterwards must opt out, or one
    // request stores two captures and the explicit capture's diff lookup can
    // race the detached one, reporting an empty history that is not empty.
    // A caller that only creates a site must NOT opt out: without the first
    // screenshot the site has no baseline, so its first scheduled capture has
    // nothing to diff against and change detection slips a whole cron period.
    capture_now: captureOnCreate,
  } as ScheduleInput);

  return { schedule, created: true };
}
