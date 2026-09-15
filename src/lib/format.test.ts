import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeCapture, describeSchedule, resolveCaptureUrl, toolError } from './format.ts';
import { CapturezeApiError } from './errors.ts';

const BASE = 'https://captureze.com';

describe('resolveCaptureUrl', () => {
  it('uses the computed url from the list endpoint', () => {
    assert.equal(
      resolveCaptureUrl(
        { id: '1', schedule_id: 's', file_path: 'a/b.png', url: '/screenshots/a/b.png' },
        BASE,
      ),
      'https://captureze.com/screenshots/a/b.png',
    );
  });

  it('prefers an absolute storage URL from the user bucket', () => {
    assert.equal(
      resolveCaptureUrl(
        { id: '1', schedule_id: 's', file_path: 'a/b.png', storage_url: 'https://cdn.example.com/a/b.png' },
        BASE,
      ),
      'https://cdn.example.com/a/b.png',
    );
  });

  it('falls back to the platform screenshots path when only file_path is known', () => {
    assert.equal(
      resolveCaptureUrl({ id: '1', schedule_id: 's', file_path: 'a/b.png' }, BASE),
      'https://captureze.com/screenshots/a/b.png',
    );
  });
});

describe('describeCapture', () => {
  it('keeps a missing diff distinguishable from a zero diff', () => {
    const first = describeCapture({ id: '1', schedule_id: 's', file_path: 'a.png' }, BASE);
    const unchanged = describeCapture(
      { id: '2', schedule_id: 's', file_path: 'b.png', diff_percent: 0 },
      BASE,
    );
    assert.equal(first.diff_percent, null);
    assert.equal(unchanged.diff_percent, 0);
  });
});

describe('toolError', () => {
  it('reports API failures as tool errors carrying the fix', () => {
    const result = toolError(new CapturezeApiError(401, 'Invalid API key'));
    assert.equal(result.isError, true);
    const [block] = result.content;
    assert.ok(block?.type === 'text');
    assert.match(block.text, /CAPTUREZE_API_KEY/);
  });

  // The API used to answer every failed capture with 500, so a slow page and a
  // page that blocked us were indistinguishable from a bug on our side — and
  // the agent had nothing to act on.
  it('tells a slow page apart from a blocked one and from a fault of ours', () => {
    const timedOut = toolError(new CapturezeApiError(504, 'The website took too long to respond'));
    assert.match((timedOut.content[0] as { text: string }).text, /too long/i);

    const blocked = toolError(new CapturezeApiError(502, 'Anti-bot protection rejected our access'));
    assert.match((blocked.content[0] as { text: string }).text, /not a Captureze fault/i);

    const ours = toolError(new CapturezeApiError(503, 'Proxy provider issue'));
    assert.match((ours.content[0] as { text: string }).text, /our infrastructure/i);

    const unknown = toolError(new CapturezeApiError(500, 'Something broke'));
    assert.match((unknown.content[0] as { text: string }).text, /Retry once/i);
  });
});

describe('describeSchedule', () => {
  // The list endpoint joins the newest capture as a nested `latest_screenshot`
  // object (src/db/schedules.js). Reading flat `last_screenshot_at` fields the
  // API has never emitted is what made every site report "never captured".
  it('reports the last capture from the nested latest_screenshot the API sends', () => {
    const site = describeSchedule({
      id: 'abc',
      name: 'apple.com',
      url: 'https://apple.com',
      cron_expression: '0 3 * * *',
      latest_screenshot: {
        id: 'ed30da43',
        file_path: 'a.png',
        diff_percent: 1.25,
        created_at: '2026-09-15T18:27:25.483Z',
      },
    });

    assert.equal(site.last_capture_at, '2026-09-15T18:27:25.483Z');
    assert.equal(site.last_diff_percent, 1.25);
  });

  it('keeps a first capture (no diff yet) distinguishable from no capture at all', () => {
    const firstCapture = describeSchedule({
      id: 'abc',
      name: 'apple.com',
      url: 'https://apple.com',
      cron_expression: '0 3 * * *',
      latest_screenshot: {
        id: '1',
        file_path: 'a.png',
        diff_percent: null,
        created_at: '2026-09-15T18:27:20.430Z',
      },
    });
    const neverCaptured = describeSchedule({
      id: 'def',
      name: 'example.com',
      url: 'https://example.com',
      cron_expression: '0 3 * * *',
      latest_screenshot: null,
    });

    assert.equal(firstCapture.last_capture_at, '2026-09-15T18:27:20.430Z');
    assert.equal(firstCapture.last_diff_percent, null);
    assert.equal(neverCaptured.last_capture_at, null);
    assert.equal(neverCaptured.last_diff_percent, null);
  });
});
