import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCapturezeServer } from './server.ts';
import { loadConfig } from './lib/config.ts';
import type { FetchLike } from './lib/client.ts';

const CONFIG = loadConfig({ CAPTUREZE_BASE_URL: 'https://captureze.com' } as NodeJS.ProcessEnv);

const SITE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'example.com',
  url: 'https://example.com',
  cron_expression: '0 3 * * *',
  is_active: false,
};

const CAPTURE = {
  id: '22222222-2222-4222-8222-222222222222',
  schedule_id: SITE.id,
  file_path: 'example/shot.png',
  file_size: 2048,
  diff_percent: 3.5,
  created_at: '2026-08-19T10:00:00.000Z',
};

// The real shape of GET /api/billing: the plan and the trial flag live inside
// `subscription`, and `subscription` is null when the account has none.
const BILLING = {
  hasSubscription: true,
  subscription: {
    plan: 'pro',
    status: 'trialing',
    isTrial: true,
    isDormant: false,
    trialDaysRemaining: 7,
    trialQuotaPlan: 'starter',
  },
  limits: { sites: 10, screenshots: 1500, min_interval_minutes: 240, retention_days: 30 },
  usage: { sites: 0, screenshots: 0 },
  features: ['Full visual diff'],
};

interface RouteTable {
  sites?: unknown[];
  captureStatus?: number;
  captureBody?: unknown;
  billing?: unknown;
}

function fakeApi({
  sites = [],
  captureStatus = 200,
  captureBody = CAPTURE,
  billing = BILLING,
}: RouteTable = {}): {
  fetchImpl: FetchLike;
  requests: string[];
  captureBodies: Record<string, unknown>[];
  createBodies: Record<string, unknown>[];
} {
  const requests: string[] = [];
  // Per-capture overrides travel in the POST body, so asserting on the URL
  // alone cannot tell an honoured option from a dropped one.
  const captureBodies: Record<string, unknown>[] = [];
  const createBodies: Record<string, unknown>[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${url}`);
    // Matched precisely: the base URL "https://captureze.com" itself contains
    // the substring "/capture", so a loose includes() records every request.
    if (method === 'POST' && /\/schedules\/[^/]+\/capture(\?|$)/.test(url)) {
      captureBodies.push(init?.body ? JSON.parse(String(init.body)) : {});
    }
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url.endsWith('/api/schedules') && method === 'GET') return json(sites);
    if (url.endsWith('/api/schedules') && method === 'POST') {
      createBodies.push(JSON.parse(String(init?.body)));
      return json({ ...SITE, ...JSON.parse(String(init?.body)) });
    }
    if (url.endsWith('/api/billing') && method === 'GET') return json(billing);
    if (url.includes('/capture') && method === 'POST') return json(captureBody, captureStatus);
    if (url.includes('/screenshots?')) return json([CAPTURE]);
    if (url.includes('/screenshots/')) {
      return new Response(Buffer.from('fake-png'), { headers: { 'content-type': 'image/png' } });
    }
    return json({ error: `unhandled ${method} ${url}` }, 500);
  };
  return { fetchImpl, requests, captureBodies, createBodies };
}

async function connect(fetchImpl: FetchLike, includeChatGptTools = true) {
  const server = createCapturezeServer({
    config: CONFIG,
    accessToken: 'cap_test',
    fetchImpl,
    includeChatGptTools,
  });
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe('captureze MCP server', () => {
  it('advertises the capture tools plus the ChatGPT search/fetch pair', async () => {
    const { client } = await connect(fakeApi().fetchImpl);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    assert.ok(names.includes('captureze_capture_url'));
    assert.ok(names.includes('captureze_monitor_site'));
    assert.ok(names.includes('captureze_get_capture_certificate'));
    // ChatGPT rejects a connector that lacks either of these.
    assert.ok(names.includes('search'));
    assert.ok(names.includes('fetch'));

    const destructive = tools.find((tool) => tool.name === 'captureze_delete_site');
    assert.equal(destructive?.annotations?.destructiveHint, true);
  });

  it('omits search/fetch when the host does not need them', async () => {
    const { client } = await connect(fakeApi().fetchImpl, false);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(!names.includes('search'));
    assert.ok(names.includes('captureze_capture_url'));
  });

  // Defect 2: a capture requested from one country and served from another used
  // to report plain success, and its certificate said nothing about location.
  it('reports a capture served from the wrong country as an error, not a success', async () => {
    const api = fakeApi({
      sites: [SITE],
      captureBody: {
        ...CAPTURE,
        geo_verification: {
          status: 'mismatch',
          requested_country: 'DE',
          observed_country: 'GB',
          honoured: false,
          detail: 'This capture was requested from one country but the exit IP was measured in another.',
        },
      },
    });
    const { client } = await connect(api.fetchImpl);

    const result = await client.callTool({
      name: 'captureze_capture_url',
      arguments: { url: 'https://example.com', geo_country: 'DE', include_image: false },
    });

    assert.equal(result.isError, true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    assert.match(text, /DE/);
    assert.match(text, /GB/);
    // The capture itself is kept, so the caller must still be able to reach it.
    assert.match(text, new RegExp(CAPTURE.id));
  });

  it('fails a mismatch reported without the honoured flag, so version skew cannot hide it', async () => {
    const api = fakeApi({
      sites: [SITE],
      captureBody: {
        ...CAPTURE,
        // An API build that sends the verdict but not the convenience boolean.
        geo_verification: { status: 'mismatch', requested_country: 'DE', observed_country: 'GB' },
      },
    });
    const { client } = await connect(api.fetchImpl);

    const result = await client.callTool({
      name: 'captureze_capture_url',
      arguments: { url: 'https://example.com', geo_country: 'DE', include_image: false },
    });

    assert.equal(result.isError, true);
    assert.match((result.content as { type: string; text: string }[])[0]!.text, /GB/);
  });

  it('reports an unmeasurable exit country as an error rather than a confirmed one', async () => {
    const api = fakeApi({
      sites: [SITE],
      captureBody: {
        ...CAPTURE,
        geo_verification: {
          status: 'unverified',
          requested_country: 'DE',
          observed_country: null,
          honoured: false,
          detail: 'A country was requested for this capture, but the exit location could not be measured.',
        },
      },
    });
    const { client } = await connect(api.fetchImpl);

    const result = await client.callTool({
      name: 'captureze_capture_url',
      arguments: { url: 'https://example.com', geo_country: 'DE', include_image: false },
    });

    assert.equal(result.isError, true);
    assert.match((result.content as { type: string; text: string }[])[0]!.text, /could not be measured/i);
  });

  it('leaves a capture that honoured its country, or asked for none, reporting success', async () => {
    for (const geo_verification of [
      { status: 'confirmed', requested_country: 'DE', observed_country: 'DE', honoured: true, detail: 'ok' },
      {
        status: 'not_requested',
        requested_country: null,
        observed_country: null,
        honoured: true,
        detail: 'ok',
      },
      undefined,
    ]) {
      const api = fakeApi({ sites: [SITE], captureBody: { ...CAPTURE, geo_verification } });
      const { client } = await connect(api.fetchImpl);
      const result = await client.callTool({
        name: 'captureze_capture_url',
        arguments: { url: 'https://example.com', include_image: false },
      });
      assert.equal(result.isError, undefined, `${geo_verification?.status ?? 'absent'} must not error`);
    }
  });

  // Defect 4: POST /api/schedules takes its own detached first screenshot, so a
  // single capture_url produced two stored captures five seconds apart — and the
  // tool's own diff lookup ran before the first had landed, reporting "no
  // previous capture" against a history that was not empty.
  it('creating a site does not also trigger a second, server-side capture', async () => {
    const api = fakeApi({ sites: [] });
    const { client } = await connect(api.fetchImpl);

    await client.callTool({
      name: 'captureze_capture_url',
      arguments: { url: 'https://example.com', include_image: false },
    });

    const creates = api.requests.filter((r) => r === 'POST https://captureze.com/api/schedules');
    assert.equal(creates.length, 1);
    assert.equal(api.captureBodies.length, 1, 'exactly one capture per capture request');
    assert.equal(
      api.createBodies[0]!.capture_now,
      false,
      'the MCP takes its own capture, so the API must not take a detached one too',
    );
  });

  // Defect 1: options reached the capture only on the request that created the
  // site. Asking for Germany on a URL the account had seen before produced a US
  // capture with no error — the single most damaging failure in the backlog.
  it('applies capture options to a site that already exists, not only to a new one', async () => {
    const existing = { ...SITE, geo_country: null, geo_city: null };
    const api = fakeApi({ sites: [existing] });
    const { client } = await connect(api.fetchImpl);

    const result = await client.callTool({
      name: 'captureze_capture_url',
      arguments: { url: 'https://example.com', geo_country: 'DE', full_page: true, include_image: false },
    });

    assert.equal(result.isError, undefined);
    assert.ok(
      !api.requests.some((request) => request.startsWith('POST https://captureze.com/api/schedules ')),
      'the existing site must be reused, not duplicated',
    );
    assert.equal(api.captureBodies.length, 1);
    assert.equal(api.captureBodies[0]!.geo_country, 'DE');
    assert.equal(api.captureBodies[0]!.full_page, true);
  });

  it('sends no capture options when none were asked for', async () => {
    const api = fakeApi({ sites: [SITE] });
    const { client } = await connect(api.fetchImpl);

    await client.callTool({
      name: 'captureze_capture_url',
      arguments: { url: 'https://example.com', include_image: false },
    });

    assert.deepEqual(api.captureBodies[0], {}, 'an untouched site captures with its stored settings');
  });

  it('reports a refused capture option as an error instead of capturing anyway', async () => {
    const api = fakeApi({ sites: [SITE] });
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.includes('/capture') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            error: 'Geo-targeting by country requires Pro plan or higher',
            code: 'FEATURE_REQUIRED',
          }),
          { status: 402, headers: { 'content-type': 'application/json' } },
        );
      }
      return api.fetchImpl(url, init);
    };
    const { client } = await connect(fetchImpl);

    const result = await client.callTool({
      name: 'captureze_capture_url',
      arguments: { url: 'https://example.com', geo_country: 'DE', include_image: false },
    });

    assert.equal(result.isError, true);
    const [block] = result.content as { type: string; text: string }[];
    assert.match(block!.text, /Pro plan/);
  });

  it('captures a URL, creating the site once, and returns the image', async () => {
    const { fetchImpl, requests } = fakeApi();
    const { client } = await connect(fetchImpl);

    const result = await client.callTool({
      name: 'captureze_capture_url',
      arguments: { url: 'https://example.com', full_page: true },
    });

    const content = result.content as Array<{ type: string; data?: string; text?: string }>;
    const image = content.find((block) => block.type === 'image');
    assert.ok(image, 'the model should get the screenshot itself');
    assert.equal(Buffer.from(image!.data!, 'base64').toString(), 'fake-png');

    const structured = result.structuredContent as Record<string, unknown>;
    assert.equal(structured.site_created, true);
    assert.equal(structured.diff_percent, 3.5);
    assert.equal(structured.image_url, 'https://captureze.com/screenshots/example/shot.png');

    assert.ok(requests.some((entry) => entry === 'POST https://captureze.com/api/schedules'));
    assert.ok(requests.some((entry) => entry.includes('/capture')));
  });

  it('reuses the existing site when the same page is captured again', async () => {
    const { fetchImpl, requests } = fakeApi({ sites: [SITE] });
    const { client } = await connect(fetchImpl);

    const result = await client.callTool({
      name: 'captureze_capture_url',
      arguments: { url: 'https://www.example.com/' },
    });

    assert.equal((result.structuredContent as Record<string, unknown>).site_created, false);
    assert.ok(!requests.some((entry) => entry === 'POST https://captureze.com/api/schedules'));
  });

  it('turns a plan limit into a tool error the model can report', async () => {
    const { fetchImpl } = fakeApi({
      sites: [SITE],
      captureStatus: 402,
      captureBody: { error: 'Screenshot limit reached', code: 'SCREENSHOT_LIMIT', limit: 100 },
    });
    const { client } = await connect(fetchImpl);

    const result = await client.callTool({
      name: 'captureze_capture_url',
      arguments: { url: 'https://example.com' },
    });

    assert.equal(result.isError, true);
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? '';
    assert.match(text, /SCREENSHOT_LIMIT/);
    assert.match(text, /do not retry/i);
  });

  it('skips the image download when the caller only wants metadata', async () => {
    const { fetchImpl, requests } = fakeApi({ sites: [SITE] });
    const { client } = await connect(fetchImpl);

    const result = await client.callTool({
      name: 'captureze_capture_url',
      arguments: { url: 'https://example.com', include_image: false },
    });

    assert.ok(!(result.content as Array<{ type: string }>).some((block) => block.type === 'image'));
    assert.ok(!requests.some((entry) => entry.includes('/screenshots/example/shot.png')));
  });

  it('answers ChatGPT search with id/title/text/url records', async () => {
    const { fetchImpl } = fakeApi({ sites: [SITE] });
    const { client } = await connect(fetchImpl);

    const result = await client.callTool({ name: 'search', arguments: { query: 'example' } });
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as {
      results: Array<Record<string, string>>;
    };

    assert.ok(payload.results.length > 0);
    for (const entry of payload.results) {
      assert.ok(entry.id && entry.title && entry.text && entry.url);
    }
    assert.equal(payload.results[0]!.id, `site:${SITE.id}`);
  });

  it('exposes the account sites as a resource', async () => {
    const { client } = await connect(fakeApi({ sites: [SITE] }).fetchImpl);
    const { contents } = await client.readResource({ uri: 'captureze://sites' });
    const [entry] = contents;
    assert.ok(entry && 'text' in entry);
    assert.equal(entry.mimeType, 'application/json');
    assert.match(entry.text, /example\.com/);
  });

  // The server tells the model to call this after a 402 to say what needs
  // upgrading, so the summary line has to be able to name the current plan.
  it('names the plan and marks the trial in the account summary', async () => {
    const { client } = await connect(fakeApi().fetchImpl);

    const result = await client.callTool({ name: 'captureze_account_status', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const summary = content[0]!.text.split('\n')[0];

    assert.equal(summary, 'Plan: pro (trial)');
  });

  it('does not call a paid subscription a trial', async () => {
    const billing = {
      ...BILLING,
      subscription: { ...BILLING.subscription, plan: 'business', status: 'active', isTrial: false },
    };
    const { client } = await connect(fakeApi({ billing }).fetchImpl);

    const result = await client.callTool({ name: 'captureze_account_status', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;

    assert.equal(content[0]!.text.split('\n')[0], 'Plan: business');
  });

  it('says unknown only when the account really has no subscription', async () => {
    const billing = { hasSubscription: false, subscription: null, limits: {}, usage: {} };
    const { client } = await connect(fakeApi({ billing }).fetchImpl);

    const result = await client.callTool({ name: 'captureze_account_status', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;

    assert.equal(content[0]!.text.split('\n')[0], 'Plan: unknown');
  });

  describe('timeouts and retries', () => {
    const EXECUTION = '33333333-3333-4333-8333-333333333333';
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    it('sends the idempotency key it was given, so a retried call collects the original capture', async () => {
      const api = fakeApi({ sites: [SITE] });
      const keys: (string | undefined)[] = [];
      const fetchImpl: FetchLike = async (url, init) => {
        if (url.includes('/capture') && init?.method === 'POST') {
          keys.push((init.headers as Record<string, string>)['Idempotency-Key']);
        }
        return api.fetchImpl(url, init);
      };
      const { client } = await connect(fetchImpl);

      const result = await client.callTool({
        name: 'captureze_capture_url',
        arguments: { url: 'https://example.com', include_image: false, idempotency_key: 'retry-me' },
      });

      assert.deepEqual(keys, ['retry-me']);
      const [block] = result.content as { type: string; text: string }[];
      assert.match(block!.text, /nothing was captured or billed again/);
      assert.equal((result.structuredContent as Record<string, unknown>).idempotency_key, 'retry-me');
    });

    it('a capture already running is waited for and named, not silently passed off as this one', async () => {
      const api = fakeApi({ sites: [SITE] });
      const fetchImpl: FetchLike = async (url, init) => {
        if (url.includes('/capture') && init?.method === 'POST') {
          return json({ error: 'running', code: 'CAPTURE_IN_PROGRESS', execution_id: EXECUTION }, 409);
        }
        if (url.includes(`/api/executions/${EXECUTION}`)) {
          return json({
            execution_id: EXECUTION,
            status: 'success',
            response: { status: 200, body: CAPTURE },
          });
        }
        return api.fetchImpl(url, init);
      };
      const { client } = await connect(fetchImpl);

      const result = await client.callTool({
        name: 'captureze_capture_site',
        arguments: { site_id: SITE.id, include_image: false },
      });

      assert.equal(result.isError, undefined);
      const [block] = result.content as { type: string; text: string }[];
      assert.match(block!.text, /already running/);
      assert.match(block!.text, new RegExp(EXECUTION));
    });

    it('does not hand back a running capture from another country as the one asked for', async () => {
      const api = fakeApi({ sites: [SITE] });
      let posts = 0;
      const fetchImpl: FetchLike = async (url, init) => {
        if (url.includes('/capture') && init?.method === 'POST') {
          posts++;
          if (posts === 1)
            return json({ error: 'running', code: 'CAPTURE_IN_PROGRESS', execution_id: EXECUTION }, 409);
          return json({
            ...CAPTURE,
            id: 'own-capture',
            geo_verification: {
              status: 'confirmed',
              requested_country: 'DE',
              observed_country: 'DE',
              honoured: true,
            },
          });
        }
        if (url.includes(`/api/executions/${EXECUTION}`)) {
          // The capture that was running had no country at all.
          return json({
            execution_id: EXECUTION,
            status: 'success',
            response: { status: 200, body: CAPTURE },
          });
        }
        return api.fetchImpl(url, init);
      };
      const { client } = await connect(fetchImpl);

      const result = await client.callTool({
        name: 'captureze_capture_url',
        arguments: { url: 'https://example.com', geo_country: 'DE', include_image: false },
      });

      assert.equal(posts, 2, 'the running capture is waited out, then this one is taken');
      assert.equal((result.structuredContent as Record<string, unknown>).capture_id, 'own-capture');
    });
  });
});
