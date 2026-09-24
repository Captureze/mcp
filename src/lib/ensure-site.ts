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
  /**
   * What was changed on an existing site to honour `monitor: true`: empty when
   * nothing needed to change. Reported so a reused site is never silently left
   * paused, or on a schedule other than the one asked for.
   */
  changed: string[];
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
  /**
   * With `monitor`, also apply `settings` and `name` to an existing site. For
   * "monitor this page with these settings". Off for a capture, whose options
   * belong to that one capture and must not change a site the user may be
   * monitoring on its own terms.
   */
  applySettingsToExisting?: boolean;
}

export async function ensureSiteForUrl({
  client,
  url,
  settings = {},
  monitor = false,
  cronExpression,
  name,
  captureOnCreate = true,
  applySettingsToExisting = false,
}: EnsureSiteOptions): Promise<EnsureSiteResult> {
  const existing = await client.listSchedules();
  const match = existing.find((schedule) => sameTarget(schedule.url, url));
  if (match)
    return reuseSite(client, match, { monitor, cronExpression, name, settings, applySettingsToExisting });

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

  return { schedule, created: true, changed: [] };
}

/**
 * An existing site for the URL is reused rather than duplicated — but a request
 * to monitor it is honoured, not dropped. The site may have been created
 * paused by an earlier ad-hoc capture; `monitor: true` must turn it on.
 *
 * Without `monitor`, the site is left exactly as it is: a one-off capture never
 * pauses, reschedules or reconfigures a site someone is monitoring.
 */
async function reuseSite(
  client: CapturezeClient,
  site: Schedule,
  {
    monitor,
    cronExpression,
    name,
    settings,
    applySettingsToExisting,
  }: {
    monitor: boolean;
    cronExpression?: string;
    name?: string;
    settings: Partial<ScheduleInput>;
    applySettingsToExisting: boolean;
  },
): Promise<EnsureSiteResult> {
  if (!monitor) return { schedule: site, created: false, changed: [] };

  const update: Partial<ScheduleInput> = {};
  const changed: string[] = [];
  if (!site.is_active) {
    update.is_active = true;
    changed.push('resumed (it was paused)');
  }
  if (cronExpression && cronExpression !== site.cron_expression) {
    update.cron_expression = cronExpression;
    changed.push(`schedule "${site.cron_expression}" -> "${cronExpression}"`);
  }
  if (applySettingsToExisting) {
    const extra = { ...settings, ...(name ? { name } : {}) } as Record<string, unknown>;
    const current = site as unknown as Record<string, unknown>;
    const differing = Object.keys(extra).filter(
      (key) => extra[key] !== undefined && JSON.stringify(extra[key]) !== JSON.stringify(current[key]),
    );
    for (const key of differing) (update as Record<string, unknown>)[key] = extra[key];
    if (differing.length > 0) changed.push(`updated ${differing.join(', ')}`);
  }

  if (changed.length === 0) return { schedule: site, created: false, changed };
  const schedule = await client.updateSchedule(site.id, update);
  return { schedule, created: false, changed };
}
