import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCapturezeServer } from './server.ts';
import { loadConfig } from './lib/config.ts';
import type { FetchLike } from './lib/client.ts';

/**
 * What each tool may say about a site, and that it says the same thing
 * everywhere.
 */

const CONFIG = loadConfig({ CAPTUREZE_BASE_URL: 'https://captureze.com' } as NodeJS.ProcessEnv);

// Values that must never reach a model, each unique enough to grep for.
const SECRETS = {
  user_id: 'user_SECRET_OWNER_42',
  username: 'SECRET_BASIC_USER',
  password: 'SECRET_BASIC_PASS_9f3',
  header: 'SECRET_HEADER_TOKEN_77',
  script: 'window.SECRET_INJECTED_SCRIPT()',
  email: 'secret-notify@example.invalid',
  internal: 'SECRET_INTERNAL_VALUE',
};

// Fields the API may carry that no public shape includes. `internal_*` stand
// for anything the API adds that is not meant for clients.
const FORBIDDEN_KEYS = [
  'user_id',
  'auth_config',
  'custom_headers',
  'inject_script',
  'notification_email',
  'internal_note',
  'internal_usage',
];

const SECRET_SITE = {
  id: '33333333-3333-4333-8333-333333333333',
  user_id: SECRETS.user_id,
  name: 'Members area',
  url: 'https://members.example.com/',
  cron_expression: '0 9 * * *',
  timezone: null,
  effective_timezone: 'Europe/Madrid',
  is_active: true,
  width: 1920,
  height: 1080,
  full_page: true,
  viewport_preset: null,
  output_format: 'png',
  diff_threshold: 5,
  notify_on_diff: true,
  notification_email: SECRETS.email,
  geo_country: 'DE',
  geo_city: 'Berlin',
  capture_recipe: 'consent_flow',
  recipe_config: { accept_selector: '#accept', reject_selector: '#reject', wait_after_click_ms: 1500 },
  dismiss_cookie_banners: false,
  auth_config: { type: 'basic', username: SECRETS.username, password: SECRETS.password },
  custom_headers: { 'X-Token': SECRETS.header },
  inject_script: SECRETS.script,
  internal_note: SECRETS.internal,
  latest_screenshot: {
    id: '44444444-4444-4444-8444-444444444444',
    file_path: 'members/a.png',
    diff_percent: 0.42,
    created_at: '2026-10-09T07:00:46.144Z',
    internal_note: SECRETS.internal,
    state: 'post_accept',
  },
  latest_execution: { id: 'e1', status: 'completed', created_at: '2026-10-09T07:00:40Z' },
};

const OTHER_SITES = [
  {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Sandbox',
    url: 'https://example.com/',
    cron_expression: '0 9 * * *',
    timezone: 'Europe/Madrid',
    effective_timezone: 'Europe/Madrid',
    is_active: false,
    latest_screenshot: {
      id: 'c-old',
      file_path: 'x.png',
      diff_percent: null,
      created_at: '2026-10-01T09:00:00Z',
    },
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    name: 'Never captured',
    url: 'https://never.example.com/',
    cron_expression: '0 9 * * *',
    timezone: 'UTC',
    effective_timezone: 'UTC',
    is_active: true,
    latest_screenshot: null,
  },
];

const FRAMES = [
  {
    id: 'f-pre',
    schedule_id: SECRET_SITE.id,
    file_path: 'm/pre.png',
    state: 'pre_consent',
    session_group: 'g1',
    internal_note: SECRETS.internal,
    created_at: '2026-10-09T07:00:40Z',
  },
  {
    id: 'f-acc',
    schedule_id: SECRET_SITE.id,
    file_path: 'm/acc.png',
    state: 'post_accept',
    session_group: 'g1',
    internal_note: SECRETS.internal,
    created_at: '2026-10-09T07:00:46Z',
  },
  {
    id: 'f-rej',
    schedule_id: SECRET_SITE.id,
    file_path: 'm/rej.png',
    state: 'post_reject',
    session_group: 'g1',
    internal_note: SECRETS.internal,
    created_at: '2026-10-09T07:00:44Z',
  },
];

const BILLING = {
  hasSubscription: true,
  subscription: {
    plan: 'business',
    status: 'active',
    isTrial: false,
    isDormant: false,
    trialDaysRemaining: null,
  },
  limits: { sites: 200, screenshots: 20000, min_interval_minutes: 15 },
  usage: { sites: 6, screenshots: 233 },
  percentages: { sites: 3, screenshots: 1, min_interval_minutes: 0 },
  features: ['All Pro features', 'Priority support', 'Geo-targeting (city)'],
  entitlements: [
    { key: 'full_visual_diff', label: 'Full visual diff' },
    { key: 'geo_city', label: 'Geo-targeting by city' },
  ],
  internal_usage: { note: SECRETS.internal },
};

function fakeApi() {
  const store: Record<string, unknown>[] = [structuredClone(SECRET_SITE), ...structuredClone(OTHER_SITES)];
  const captures: string[] = [];
  const created: Record<string, unknown>[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

    if (url.endsWith('/api/schedules') && method === 'GET') return json(store);
    if (url.endsWith('/api/schedules') && method === 'POST') {
      created.push(body);
      const site = {
        ...body,
        id: '77777777-7777-4777-8777-777777777777',
        effective_timezone: 'Europe/Madrid',
        latest_screenshot: null,
      };
      store.push(site);
      return json(site, 201);
    }
    if (url.endsWith('/api/billing')) return json(BILLING);
    if (/\/api\/schedules\/[^/]+\/capture/.test(url) && method === 'POST') {
      const siteId = /schedules\/([^/]+)\/capture/.exec(url)![1]!;
      captures.push(siteId);
      return json({ ...FRAMES[0], id: `cap-${captures.length}`, schedule_id: siteId, state: null });
    }
    if (/\/api\/schedules\/[^/]+\/screenshots/.test(url)) return json(FRAMES);
    if (/\/api\/schedules\/[^/]+\/executions/.test(url)) {
      return json([
        {
          id: 'run-1',
          schedule_id: SECRET_SITE.id,
          status: 'completed',
          screenshot_id: 'f-pre',
          started_at: '2026-10-09T07:00:30Z',
          captures: [
            { capture_id: 'f-pre', stage: 'pre_consent' },
            { capture_id: 'f-acc', stage: 'post_accept' },
            { capture_id: 'f-rej', stage: 'post_reject' },
          ],
        },
      ]);
    }
    const one = /\/api\/schedules\/([^/?]+)$/.exec(url);
    if (one) {
      const index = store.findIndex((site) => site.id === one[1]);
      if (index === -1) return json({ error: 'Site not found' }, 404);
      if (method === 'PUT') store[index] = { ...store[index], ...body };
      return json(store[index]);
    }
    if (url.includes('/screenshots/')) {
      return new Response(Buffer.from('png'), { headers: { 'content-type': 'image/png' } });
    }
    return json({ error: `unhandled ${method} ${url}` }, 500);
  };
  return { fetchImpl, captures, created };
}

async function connect(fetchImpl: FetchLike) {
  const server = createCapturezeServer({ config: CONFIG, accessToken: 'cap_test', fetchImpl });
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

type Structured = Record<string, unknown>;

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, `${name} failed: ${JSON.stringify(result.content)}`);
  return result;
}

function assertNoLeak(label: string, result: unknown) {
  // Text blocks hold JSON inside strings, so look at the raw serialisation —
  // a key or a value anywhere in it is a leak.
  const everything = JSON.stringify(result);
  for (const key of FORBIDDEN_KEYS) {
    assert.ok(!new RegExp(`\\\\?"${key}\\\\?"`).test(everything), `${label} exposes "${key}"`);
  }
  for (const value of Object.values(SECRETS)) {
    assert.ok(!everything.includes(value), `${label} exposes the secret value ${value}`);
  }
}

describe('public shapes', () => {
  it('no tool returns credentials, headers, scripts, owner ids or internal fields', async () => {
    const api = fakeApi();
    const client = await connect(api.fetchImpl);
    const id = SECRET_SITE.id;

    const results: [string, unknown][] = [
      ['fetch', await call(client, 'fetch', { id: `site:${id}` })],
      ['fetch capture', await call(client, 'fetch', { id: `capture:${id}:f-acc` })],
      ['get_site', await call(client, 'captureze_get_site', { site_id: id })],
      ['list_sites', await call(client, 'captureze_list_sites')],
      ['search', await call(client, 'search', { query: 'members' })],
      ['search all', await call(client, 'search', { query: '' })],
      ['update_site', await call(client, 'captureze_update_site', { site_id: id, name: SECRET_SITE.name })],
      [
        'monitor_site',
        await call(client, 'captureze_monitor_site', { url: SECRET_SITE.url, cron_expression: '0 9 * * *' }),
      ],
      ['list_captures', await call(client, 'captureze_list_captures', { site_id: id })],
      ['list_capture_runs', await call(client, 'captureze_list_capture_runs', { site_id: id })],
      ['account_status', await call(client, 'captureze_account_status')],
    ];
    for (const [label, result] of results) assertNoLeak(label, result);

    const resource = await client.readResource({ uri: 'captureze://sites' });
    assertNoLeak('captureze://sites', resource);
  });

  it('says that a site has auth, headers or a script without saying what they are', async () => {
    const client = await connect(fakeApi().fetchImpl);
    const { structuredContent } = await call(client, 'captureze_get_site', { site_id: SECRET_SITE.id });
    const site = (structuredContent as Structured).site as Structured;
    assert.equal(site.has_auth, true);
    assert.equal(site.has_custom_headers, true);
    assert.equal(site.has_inject_script, true);
    assert.deepEqual(site.recipe_config, { accept_selector: '#accept', reject_selector: '#reject' });
  });

  it('fetch keeps text valid JSON with only the public site and captures', async () => {
    const client = await connect(fakeApi().fetchImpl);
    const { structuredContent } = await call(client, 'fetch', { id: `site:${SECRET_SITE.id}` });
    const parsed = JSON.parse((structuredContent as Structured).text as string) as Structured;
    assert.deepEqual(Object.keys(parsed).sort(), ['recent_captures', 'site']);
  });

  it('every tool returns the same site object with the same values', async () => {
    const api = fakeApi();
    const client = await connect(api.fetchImpl);
    const id = SECRET_SITE.id;
    const siteOf = (result: object) =>
      ((result as { structuredContent?: unknown }).structuredContent as Structured).site;

    const listed = ((await call(client, 'captureze_list_sites')).structuredContent as Structured)
      .sites as Structured[];
    const fromList = listed.find((site) => site.id === id);
    const fromGet = siteOf(await call(client, 'captureze_get_site', { site_id: id }));
    const fromUpdate = siteOf(
      await call(client, 'captureze_update_site', { site_id: id, name: SECRET_SITE.name }),
    );
    const fromMonitor = siteOf(
      await call(client, 'captureze_monitor_site', { url: SECRET_SITE.url, cron_expression: '0 9 * * *' }),
    );
    const fromCapture = siteOf(
      await call(client, 'captureze_capture_url', { url: SECRET_SITE.url, include_image: false }),
    );
    const fetched = (await call(client, 'fetch', { id: `site:${id}` })).structuredContent as Structured;
    const fromFetch = (JSON.parse(fetched.text as string) as Structured).site;

    for (const [label, site] of [
      ['get_site', fromGet],
      ['update_site', fromUpdate],
      ['monitor_site', fromMonitor],
      ['capture_url', fromCapture],
      ['fetch', fromFetch],
    ] as const) {
      assert.deepEqual(site, fromList, `${label} disagrees with list_sites`);
    }

    assert.deepEqual(fromList, {
      id,
      name: 'Members area',
      url: 'https://members.example.com/',
      cron_expression: '0 9 * * *',
      timezone: 'Europe/Madrid',
      monitoring_active: true,
      viewport: 'desktop',
      full_page: true,
      output_format: 'png',
      geo: { country: 'DE', city: 'Berlin' },
      capture_recipe: 'consent_flow',
      recipe_config: { accept_selector: '#accept', reject_selector: '#reject' },
      dismiss_cookie_banners: false,
      diff_threshold: 5,
      notify_on_diff: true,
      has_auth: true,
      has_custom_headers: true,
      has_inject_script: true,
      last_capture_at: '2026-10-09T07:00:46.144Z',
      last_diff_percent: 0.42,
    });
  });

  it('a custom viewport is named custom and carries its size', async () => {
    const api = fakeApi();
    const client = await connect(api.fetchImpl);
    await call(client, 'captureze_update_site', {
      site_id: OTHER_SITES[1]!.id,
      viewport_preset: 'custom',
      width: 1280,
      height: 720,
    });
    const { structuredContent } = await call(client, 'captureze_get_site', { site_id: OTHER_SITES[1]!.id });
    const site = (structuredContent as Structured).site as Structured;
    assert.equal(site.viewport, 'custom');
    assert.equal(site.width, 1280);
    assert.equal(site.height, 720);
  });

  it('list_sites puts the newest capture first and never-captured sites last', async () => {
    const client = await connect(fakeApi().fetchImpl);
    const { structuredContent } = await call(client, 'captureze_list_sites');
    const names = ((structuredContent as Structured).sites as Structured[]).map((site) => site.name);
    assert.deepEqual(names, ['Members area', 'Sandbox', 'Never captured']);
  });

  it('a 404 speaks of a site, not a schedule', async () => {
    const client = await connect(fakeApi().fetchImpl);
    const result = await client.callTool({
      name: 'captureze_get_site',
      arguments: { site_id: '99999999-9999-4999-8999-999999999999' },
    });
    assert.equal(result.isError, true);
    const text = (result.content as { text: string }[])[0]!.text;
    assert.match(text, /404: Site not found/);
    assert.doesNotMatch(text, /schedule/i);
  });
});

describe('monitor_site initial capture', () => {
  it('a new monitor takes one capture now and reports it', async () => {
    const api = fakeApi();
    const client = await connect(api.fetchImpl);
    const { structuredContent } = await call(client, 'captureze_monitor_site', {
      url: 'https://example.net/',
      cron_expression: '0 9 * * *',
    });
    const out = structuredContent as Structured;
    assert.equal(out.site_created, true);
    assert.equal(api.created[0]!.capture_now, false, 'no second, detached capture by the API');
    assert.equal(api.captures.length, 1);
    const initial = out.initial_capture as Structured;
    assert.equal(initial.capture_id, 'cap-1');
    assert.ok(initial.captured_at);
    assert.match(String(initial.image_url), /^https:\/\/captureze\.com\//);
  });

  it('a site already monitored on the same schedule takes nothing', async () => {
    const api = fakeApi();
    const client = await connect(api.fetchImpl);
    const { structuredContent } = await call(client, 'captureze_monitor_site', {
      url: SECRET_SITE.url,
      cron_expression: SECRET_SITE.cron_expression,
    });
    assert.equal((structuredContent as Structured).initial_capture, null);
    assert.equal(api.captures.length, 0);
  });

  it('resuming a paused site takes one capture', async () => {
    const api = fakeApi();
    const client = await connect(api.fetchImpl);
    const { structuredContent } = await call(client, 'captureze_monitor_site', {
      url: 'https://example.com/',
      cron_expression: '0 9 * * *',
    });
    assert.equal(api.captures.length, 1);
    assert.equal(((structuredContent as Structured).initial_capture as Structured).capture_id, 'cap-1');
  });
});

describe('search', () => {
  it('names a capture by the instant it was photographed, not when it was stored', async () => {
    const api = fakeApi();
    const fetchImpl: FetchLike = async (url, init) => {
      if (/\/api\/schedules\/[^/]+\/screenshots/.test(url)) {
        return new Response(
          JSON.stringify([
            { ...FRAMES[1], created_at: '2026-10-12T12:23:58.689Z', captured_at: '2026-10-12T12:23:52.592Z' },
          ]),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/schedules') && (init?.method ?? 'GET') === 'GET') {
        const site = {
          ...SECRET_SITE,
          latest_screenshot: {
            ...SECRET_SITE.latest_screenshot,
            created_at: '2026-10-12T12:23:58.689Z',
            captured_at: '2026-10-12T12:23:52.592Z',
          },
        };
        return new Response(JSON.stringify([site]), { headers: { 'content-type': 'application/json' } });
      }
      return api.fetchImpl(url, init);
    };
    const client = await connect(fetchImpl);
    const { structuredContent } = await call(client, 'search', { query: 'members' });
    const results = (structuredContent as Structured).results as Structured[];
    const text = JSON.stringify(results);
    assert.match(text, /Last capture 2026-10-12T12:23:52\.592Z/);
    assert.match(text, /taken 2026-10-12T12:23:52\.592Z/);
    assert.doesNotMatch(text, /12:23:58/);
  });
});

describe('consent-flow stages', () => {
  it('every capture carries its stage', async () => {
    const client = await connect(fakeApi().fetchImpl);
    const { structuredContent } = await call(client, 'captureze_list_captures', { site_id: SECRET_SITE.id });
    const stages = ((structuredContent as Structured).captures as Structured[]).map(
      (capture) => capture.stage,
    );
    assert.deepEqual(stages, ['pre_consent', 'post_accept', 'post_reject']);
  });

  it('a run lists every capture it produced, with stages', async () => {
    const client = await connect(fakeApi().fetchImpl);
    const { structuredContent } = await call(client, 'captureze_list_capture_runs', {
      site_id: SECRET_SITE.id,
    });
    const [run] = (structuredContent as Structured).runs as Structured[];
    assert.equal(run!.capture_id, 'f-pre');
    assert.deepEqual(run!.captures, [
      { capture_id: 'f-pre', stage: 'pre_consent' },
      { capture_id: 'f-acc', stage: 'post_accept' },
      { capture_id: 'f-rej', stage: 'post_reject' },
    ]);
  });
});

describe('account_status', () => {
  it('lists entitlement keys, keeps the limits and drops internal fields and meaningless percentages', async () => {
    const client = await connect(fakeApi().fetchImpl);
    const { structuredContent } = await call(client, 'captureze_account_status');
    const account = (structuredContent as Structured).account as Structured;
    assert.equal(account.plan, 'business');
    assert.deepEqual(account.features, BILLING.entitlements);
    assert.deepEqual(account.limits, { sites: 200, screenshots: 20000, min_interval_minutes: 15 });
    assert.deepEqual(account.percentages, { sites: 3, screenshots: 1 });
    assert.equal('internal_usage' in account, false);
  });
});

describe('city targeting in capture responses', () => {
  it('a city that was not honoured is said, without failing the capture', async () => {
    const api = fakeApi();
    const fetchImpl: FetchLike = async (url, init) => {
      if (/\/schedules\/[^/]+\/capture/.test(url) && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'cap-geo',
            schedule_id: SECRET_SITE.id,
            file_path: 'apple/de.png',
            created_at: '2026-10-09T07:00:46Z',
            captured_at: '2026-10-09T07:00:42Z',
            geo_verification: {
              status: 'confirmed',
              requested_country: 'DE',
              observed_country: 'DE',
              honoured: true,
              requested_city: 'Berlin',
              observed_city: 'Frankfurt am Main',
              city_status: 'not_confirmed',
              city_honoured: false,
              city_detail: 'This certificate does not attest to the requested city.',
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      return api.fetchImpl(url, init);
    };
    const client = await connect(fetchImpl);
    const result = await call(client, 'captureze_capture_site', {
      site_id: SECRET_SITE.id,
      include_image: false,
    });
    const text = (result.content as { text: string }[])[0]!.text;
    assert.match(
      text,
      /City targeting was not honoured: Berlin was requested, but the exit was placed in Frankfurt am Main/,
    );
    const out = result.structuredContent as Structured;
    assert.deepEqual(out.geo, {
      requested_country: 'DE',
      observed_country: 'DE',
      country_status: 'confirmed',
      requested_city: 'Berlin',
      observed_city: 'Frankfurt am Main',
      city_status: 'not_confirmed',
    });
    assert.equal(out.captured_at, '2026-10-09T07:00:42Z', 'the photograph, not the storage time');
  });
});

describe('consent detection results', () => {
  const DETECTION = {
    found: true,
    cmp_id: 'tcf-unknown',
    detection_method: 'heuristic',
    confidence: 'medium',
    accept: { text: 'Accepter et continuer', selector: '.gdpr-lmd-button::-p-text("Accepter et continuer")' },
    reject: null,
    candidates: [
      {
        role: 'accept',
        text: 'Accepter et continuer',
        selector: '.gdpr-lmd-button::-p-text("Accepter et continuer")',
        matchCount: 1,
      },
      { role: 'reject', text: 'Refuser', selector: 'cmp-host >>> .refuse', matchCount: 1 },
      { role: 'unknown', text: 'Paramètres', selector: '#settings', matchCount: 1 },
    ],
    warnings: ['heuristic_match', 'tcf_present_vendor_unknown'],
    diagnostics: { internal_note: SECRETS.internal },
  };

  it('pairs every Puppeteer selector with its plain CSS form', async () => {
    const api = fakeApi();
    const fetchImpl: FetchLike = async (url, init) =>
      url.includes('/api/consent/detect/')
        ? new Response(JSON.stringify({ job_id: 'job-1', status: 'succeeded', result: DETECTION }), {
            headers: { 'content-type': 'application/json' },
          })
        : api.fetchImpl(url, init);
    const client = await connect(fetchImpl);
    const result = await call(client, 'captureze_get_consent_detection', { job_id: 'job-1' });
    assertNoLeak('get_consent_detection', result);

    const detection = (result.structuredContent as Structured).detection as Structured;
    const out = detection.result as Structured;
    assert.deepEqual(out.accept, {
      text: 'Accepter et continuer',
      selector: '.gdpr-lmd-button::-p-text("Accepter et continuer")',
      css_selector: '.gdpr-lmd-button',
    });
    assert.equal(out.reject, null);
    assert.deepEqual(
      (out.candidates as Structured[]).map((candidate) => candidate.css_selector),
      ['.gdpr-lmd-button', null, '#settings'],
    );
  });
});

describe('diff_trend', () => {
  it('rounds the average instead of returning float noise', async () => {
    const api = fakeApi();
    const trend = [4.225212, 3.966628, 4.3926461].map((diff_percent, index) => ({
      id: `c-${index}`,
      captured_at: `2026-10-12T0${index}:00:00Z`,
      diff_percent,
    }));
    const fetchImpl: FetchLike = async (url, init) =>
      url.includes('/diff-trend')
        ? new Response(JSON.stringify({ trend }), { headers: { 'content-type': 'application/json' } })
        : api.fetchImpl(url, init);
    const client = await connect(fetchImpl);
    const result = await call(client, 'captureze_diff_trend', { site_id: SECRET_SITE.id });
    assert.equal((result.structuredContent as Structured).average_diff_percent, 4.1948);
  });
});
