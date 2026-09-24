import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CapturezeClient } from './client.ts';
import { ADHOC_CRON, ensureSiteForUrl } from './ensure-site.ts';

function clientWith(
  sites: unknown[],
  onCreate?: (body: unknown) => void,
  onUpdate?: (id: string, body: Record<string, unknown>) => void,
) {
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const put = /\/api\/schedules\/([^/]+)$/.exec(url);
    if (put && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      onUpdate?.(put[1]!, body);
      const site = (sites as Record<string, unknown>[]).find((candidate) => candidate.id === put[1]);
      return new Response(JSON.stringify({ ...site, ...body }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/api/schedules') && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify(sites), { headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/api/schedules') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      onCreate?.(body);
      return new Response(JSON.stringify({ id: 'new-site', ...body }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected request ${init?.method ?? 'GET'} ${url}`);
  };
  return new CapturezeClient({ baseUrl: 'https://captureze.com', apiKey: 'cap_test', fetchImpl });
}

describe('ensureSiteForUrl', () => {
  it('reuses an existing site for the same page instead of burning the site limit', async () => {
    const client = clientWith([
      { id: 'existing', name: 'example.com', url: 'https://www.example.com/', cron_expression: '0 9 * * *' },
    ]);

    const result = await ensureSiteForUrl({ client, url: 'https://example.com' });

    assert.equal(result.created, false);
    assert.equal(result.schedule.id, 'existing');
  });

  it('creates an ad-hoc site paused, on the coarsest schedule every plan allows', async () => {
    let created: Record<string, unknown> | undefined;
    const client = clientWith([], (body) => {
      created = body as Record<string, unknown>;
    });

    const result = await ensureSiteForUrl({ client, url: 'https://example.com/pricing' });

    assert.equal(result.created, true);
    assert.equal(created!.is_active, false);
    assert.equal(created!.cron_expression, ADHOC_CRON);
    assert.equal(created!.name, 'example.com/pricing');
  });

  // A caller that only creates a site relies on the API's own first screenshot
  // for its baseline; opting out unconditionally left `monitor` sites with an
  // empty history and no diff on their first scheduled capture.
  it('leaves the first screenshot to the API unless the caller captures itself', async () => {
    let created: Record<string, unknown> | undefined;
    const client = clientWith([], (body) => {
      created = body as Record<string, unknown>;
    });

    await ensureSiteForUrl({ client, url: 'https://example.com' });
    assert.equal(created!.capture_now, true, 'a site nobody captures needs its baseline');
  });

  it('opts out of the API first screenshot when the caller captures explicitly', async () => {
    let created: Record<string, unknown> | undefined;
    const client = clientWith([], (body) => {
      created = body as Record<string, unknown>;
    });

    await ensureSiteForUrl({ client, url: 'https://example.com', captureOnCreate: false });
    assert.equal(created!.capture_now, false, 'otherwise one request stores two captures');
  });

  it('creates an active site with the requested cron when monitoring', async () => {
    let created: Record<string, unknown> | undefined;
    const client = clientWith([], (body) => {
      created = body as Record<string, unknown>;
    });

    await ensureSiteForUrl({
      client,
      url: 'https://example.com',
      monitor: true,
      cronExpression: '0 9 * * 1',
      settings: { full_page: true },
    });

    assert.equal(created!.is_active, true);
    assert.equal(created!.cron_expression, '0 9 * * 1');
    assert.equal(created!.full_page, true);
  });

  // Reddit: a URL first captured ad hoc is stored paused; a later
  // `monitor: true` used to return that site untouched — still paused, on the
  // ad-hoc schedule — while the caller believed it was now being monitored.
  describe('monitor on a site that already exists', () => {
    const paused = {
      id: 'adhoc',
      name: 'example.com',
      url: 'https://example.com',
      cron_expression: ADHOC_CRON,
      is_active: false,
      diff_threshold: 5,
    };

    it('resumes a paused site and moves it to the requested schedule', async () => {
      const updates: Record<string, unknown>[] = [];
      const client = clientWith([paused], undefined, (_id, body) => updates.push(body));

      const result = await ensureSiteForUrl({
        client,
        url: 'https://example.com',
        monitor: true,
        cronExpression: '0 9 * * 1',
      });

      assert.equal(result.created, false);
      assert.deepEqual(updates, [{ is_active: true, cron_expression: '0 9 * * 1' }]);
      assert.equal(result.schedule.is_active, true);
      assert.equal(result.schedule.cron_expression, '0 9 * * 1');
      assert.equal(result.changed.length, 2);
    });

    it('changes nothing on a site already monitored as asked', async () => {
      const active = { ...paused, is_active: true, cron_expression: '0 9 * * 1' };
      const client = clientWith([active], undefined, () => assert.fail('no update needed'));

      const result = await ensureSiteForUrl({
        client,
        url: 'https://example.com',
        monitor: true,
        cronExpression: '0 9 * * 1',
      });
      assert.deepEqual(result.changed, []);
    });

    it('never pauses or reschedules a monitored site for a one-off capture', async () => {
      const active = { ...paused, is_active: true, cron_expression: '0 9 * * 1' };
      const client = clientWith([active], undefined, () => assert.fail('a capture must not touch the site'));

      const result = await ensureSiteForUrl({
        client,
        url: 'https://example.com',
        settings: { full_page: true },
      });
      assert.equal(result.schedule.is_active, true);
      assert.deepEqual(result.changed, []);
    });

    it('applies settings to the existing site only when asked to (monitor_site)', async () => {
      const updates: Record<string, unknown>[] = [];
      const client = clientWith([paused], undefined, (_id, body) => updates.push(body));

      await ensureSiteForUrl({
        client,
        url: 'https://example.com',
        monitor: true,
        cronExpression: ADHOC_CRON,
        settings: { diff_threshold: 10, full_page: true },
        applySettingsToExisting: true,
      });
      assert.deepEqual(updates, [{ is_active: true, diff_threshold: 10, full_page: true }]);
    });
  });
});
