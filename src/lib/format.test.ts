import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeCapture, resolveCaptureUrl, toolError } from './format.ts';
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
});
