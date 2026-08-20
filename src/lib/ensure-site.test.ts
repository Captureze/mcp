import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CapturezeClient } from './client.ts';
import { ADHOC_CRON, ensureSiteForUrl } from './ensure-site.ts';

function clientWith(sites: unknown[], onCreate?: (body: unknown) => void) {
  const fetchImpl = async (url: string, init?: RequestInit) => {
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
});
