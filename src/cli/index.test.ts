import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProgram, CLI_COMMANDS, isCliInvocation } from './index.ts';

describe('CLI dispatch', () => {
  it('treats a leading command word as a CLI invocation', () => {
    assert.equal(isCliInvocation(['sites']), true);
    assert.equal(isCliInvocation(['capture', 'https://example.com', '--full-page']), true);
  });

  it('leaves every server invocation alone', () => {
    // Regression guard: these are the argv shapes in every documented client config.
    assert.equal(isCliInvocation([]), false);
    assert.equal(isCliInvocation(['--http']), false);
    assert.equal(isCliInvocation(['--http', '--port', '8787']), false);
    assert.equal(isCliInvocation(['--version']), false);
  });

  it('registers a command for every name that triggers the CLI', () => {
    const registered = buildProgram()
      .commands.map((command) => command.name())
      .sort();
    assert.deepEqual(registered, [...CLI_COMMANDS].sort());
  });
});
