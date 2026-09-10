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
} {
  const requests: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${url}`);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url.endsWith('/api/schedules') && method === 'GET') return json(sites);
    if (url.endsWith('/api/schedules') && method === 'POST') {
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
  return { fetchImpl, requests };
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
});
