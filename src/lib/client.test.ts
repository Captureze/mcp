import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CapturezeClient } from './client.ts';
import { CapturezeApiError, CapturezeTimeoutError } from './errors.ts';

interface Call {
  url: string;
  init?: RequestInit;
}

function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler({ url, init });
  };
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('CapturezeClient', () => {
  it('authenticates with a bearer API key against /api', async () => {
    const { calls, fetchImpl } = stubFetch(() =>
      json([{ id: 'a', name: 'x', url: 'https://x.dev', cron_expression: '0 3 * * *' }]),
    );
    const client = new CapturezeClient({ baseUrl: 'https://captureze.com/', apiKey: 'cap_test', fetchImpl });

    await client.listSchedules();

    assert.equal(calls[0]!.url, 'https://captureze.com/api/schedules');
    assert.equal((calls[0]!.init!.headers as Record<string, string>).Authorization, 'Bearer cap_test');
  });

  it('surfaces plan limits as an actionable error', async () => {
    const { fetchImpl } = stubFetch(() =>
      json({ error: 'Site limit reached', code: 'SCHEDULE_LIMIT', limit: 1 }, 402),
    );
    const client = new CapturezeClient({ baseUrl: 'https://captureze.com', apiKey: 'cap_test', fetchImpl });

    await assert.rejects(
      () => client.createSchedule({ name: 'x', url: 'https://x.dev', cron_expression: '0 3 * * *' }),
      (error: unknown) => {
        assert.ok(error instanceof CapturezeApiError);
        assert.equal(error.status, 402);
        assert.equal(error.code, 'SCHEDULE_LIMIT');
        assert.match(error.toString(), /do not retry/i);
        return true;
      },
    );
  });

  it('explains a capture timeout instead of leaking AbortError', async () => {
    const { fetchImpl } = stubFetch(() => {
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      throw abort;
    });
    const client = new CapturezeClient({
      baseUrl: 'https://captureze.com',
      apiKey: 'cap_test',
      timeoutMs: 1000,
      fetchImpl,
    });

    await assert.rejects(() => client.capture('site-1'), CapturezeTimeoutError);
  });

  it('passes the limit through when listing captures', async () => {
    const { calls, fetchImpl } = stubFetch(() => json([]));
    const client = new CapturezeClient({ baseUrl: 'https://captureze.com', apiKey: 'cap_test', fetchImpl });

    await client.listScreenshots('site-1', 25);

    assert.equal(calls[0]!.url, 'https://captureze.com/api/schedules/site-1/screenshots?limit=25');
  });

  it('resolves platform-relative capture paths against the base URL', async () => {
    const { calls, fetchImpl } = stubFetch(
      () => new Response(Buffer.from('png-bytes'), { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    const client = new CapturezeClient({ baseUrl: 'https://captureze.com', apiKey: 'cap_test', fetchImpl });

    const image = await client.downloadImage('/screenshots/site/shot.png');

    assert.equal(calls[0]!.url, 'https://captureze.com/screenshots/site/shot.png');
    assert.equal(image.mimeType, 'image/png');
    assert.equal(Buffer.from(image.data, 'base64').toString(), 'png-bytes');
  });

  it('never sends the API key to a user-owned storage bucket', async () => {
    const { calls, fetchImpl } = stubFetch(
      () => new Response(Buffer.from('x'), { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    const client = new CapturezeClient({ baseUrl: 'https://captureze.com', apiKey: 'cap_secret', fetchImpl });

    await client.downloadImage('https://my-bucket.s3.example.com/shot.png');

    const headers = (calls[0]!.init!.headers ?? {}) as Record<string, string>;
    assert.equal(headers.Authorization, undefined);
  });

  it('falls back to the file extension when the store sends octet-stream', async () => {
    const { fetchImpl } = stubFetch(
      () =>
        new Response(Buffer.from('x'), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
    );
    const client = new CapturezeClient({ baseUrl: 'https://captureze.com', apiKey: 'cap_test', fetchImpl });

    const image = await client.downloadImage('/screenshots/a/b.jpeg');
    assert.equal(image.mimeType, 'image/jpeg');
  });
});
