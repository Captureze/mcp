import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CapturezeClient } from './client.ts';
import { CaptureStillRunningError, CapturezeApiError, CapturezeTimeoutError } from './errors.ts';

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

  describe('captures that outlive a request', () => {
    const EXECUTION = '33333333-3333-4333-8333-333333333333';
    const SHOT = { id: 'shot-1', file_path: 'site/shot.png' };

    // Answers the capture POST, then each poll, from a script of responses.
    function scripted(post: Response, polls: unknown[]) {
      let poll = 0;
      return stubFetch(({ url, init }) => {
        if (init?.method === 'POST') return post;
        if (url.includes(`/api/executions/${EXECUTION}`)) {
          const next = polls[Math.min(poll, polls.length - 1)];
          poll++;
          return json(next);
        }
        return json({ error: `unexpected ${url}` }, 500);
      });
    }

    const client = (fetchImpl: ReturnType<typeof stubFetch>['fetchImpl'], timeoutMs = 5_000) =>
      new CapturezeClient({
        baseUrl: 'https://captureze.com',
        apiKey: 'cap_test',
        fetchImpl,
        timeoutMs,
        pollIntervalMs: 1,
      });

    it('starts the capture in async mode under an idempotency key and polls it to the end', async () => {
      const { calls, fetchImpl } = scripted(json({ execution_id: EXECUTION, status: 'running' }, 202), [
        { execution_id: EXECUTION, status: 'running' },
        { execution_id: EXECUTION, status: 'success', response: { status: 200, body: SHOT } },
      ]);

      const outcome = await client(fetchImpl).captureWithOutcome('site-1', undefined, {
        idempotencyKey: 'key-1',
      });

      assert.deepEqual(outcome.screenshot, SHOT);
      assert.equal(outcome.source, 'own');
      assert.equal(outcome.executionId, EXECUTION);
      assert.equal(calls[0]!.url, 'https://captureze.com/api/schedules/site-1/capture?async=true');
      assert.equal((calls[0]!.init!.headers as Record<string, string>)['Idempotency-Key'], 'key-1');
      const polls = calls.filter((call) => call.url.includes(`/executions/${EXECUTION}`));
      assert.equal(polls.length, 2);
      // Long-polls, so the capture costs a request or two against the rate limit.
      assert.match(polls[0]!.url, /\?wait=\d+$/);
    });

    it('generates a key when none is given, so a timeout can still name one', async () => {
      const { calls, fetchImpl } = scripted(json(SHOT), []);
      const outcome = await client(fetchImpl).captureWithOutcome('site-1');
      const sent = (calls[0]!.init!.headers as Record<string, string>)['Idempotency-Key'];
      assert.match(sent!, /^[0-9a-f-]{36}$/);
      assert.equal(outcome.idempotencyKey, sent);
    });

    it('takes a 200 as the capture itself: a replay, or an API without async mode', async () => {
      const { fetchImpl } = scripted(json(SHOT), []);
      assert.deepEqual(await client(fetchImpl).capture('site-1'), SHOT);

      const replay = await client(scripted(json(SHOT), []).fetchImpl).captureWithOutcome(
        'site-1',
        undefined,
        {
          idempotencyKey: 'key-1',
        },
      );
      assert.equal(replay.source, 'replayed');
    });

    it('waits for a capture already running on the site instead of starting a second one', async () => {
      const { calls, fetchImpl } = scripted(
        json({ error: 'already running', code: 'CAPTURE_IN_PROGRESS', execution_id: EXECUTION }, 409),
        [{ execution_id: EXECUTION, status: 'success', response: { status: 200, body: SHOT } }],
      );

      const outcome = await client(fetchImpl).captureWithOutcome('site-1');

      assert.equal(outcome.source, 'joined');
      assert.deepEqual(outcome.screenshot, SHOT);
      assert.equal(calls.filter((call) => call.init?.method === 'POST').length, 1);
    });

    it('fails with the error the capture itself failed with', async () => {
      const { fetchImpl } = scripted(json({ execution_id: EXECUTION, status: 'running' }, 202), [
        {
          execution_id: EXECUTION,
          status: 'failed',
          response: { status: 502, body: { error: 'Target blocked the capture', code: 'TARGET_BLOCKED' } },
        },
      ]);

      await assert.rejects(
        () => client(fetchImpl).capture('site-1'),
        (error: unknown) => {
          assert.ok(error instanceof CapturezeApiError);
          assert.equal(error.status, 502);
          assert.equal(error.code, 'TARGET_BLOCKED');
          return true;
        },
      );
    });

    it('when time runs out, says the capture is still coming and which key collects it', async () => {
      const { fetchImpl } = scripted(json({ execution_id: EXECUTION, status: 'running' }, 202), [
        { execution_id: EXECUTION, status: 'running' },
      ]);

      await assert.rejects(
        () => client(fetchImpl, 30).captureWithOutcome('site-1', undefined, { idempotencyKey: 'key-9' }),
        (error: unknown) => {
          assert.ok(error instanceof CaptureStillRunningError);
          assert.equal(error.executionId, EXECUTION);
          assert.match(error.message, /idempotency_key "key-9"/);
          assert.match(error.message, /billed once/);
          return true;
        },
      );
    });
  });
});
