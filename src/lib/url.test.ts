import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, sameTarget, siteLabel } from './url.ts';

describe('normalizeUrl', () => {
  it('ignores scheme, www, trailing slash, default port and fragment', () => {
    assert.equal(normalizeUrl('https://www.example.com/'), 'example.com');
    assert.equal(normalizeUrl('http://example.com:80/pricing/'), 'example.com/pricing');
    assert.equal(normalizeUrl('https://example.com/pricing#plans'), 'example.com/pricing');
  });

  it('keeps the query string — a different query is a different page', () => {
    assert.equal(normalizeUrl('https://example.com/p?plan=pro'), 'example.com/p?plan=pro');
    assert.ok(!sameTarget('https://example.com/p?plan=pro', 'https://example.com/p'));
  });

  it('treats case-different hosts as the same target', () => {
    assert.ok(sameTarget('https://EXAMPLE.com/a', 'http://www.example.com/a/'));
  });

  it('reports non-URLs as not matching instead of throwing', () => {
    assert.equal(sameTarget('not a url', 'https://example.com'), false);
  });
});

describe('siteLabel', () => {
  it('names a site after host and path', () => {
    assert.equal(siteLabel('https://example.com/pricing?x=1'), 'example.com/pricing');
    assert.equal(siteLabel('https://example.com/'), 'example.com');
  });
});
