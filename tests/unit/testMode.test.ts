import { afterEach, describe, expect, it, vi } from 'vitest';
import { allVisibilities, hideTestRows, newEventVisibility, publicVisibilities } from '../../src/lib/testMode';

// The e2e suite's classes are saved with visibility 'test', and its sign-ups
// start with ZZZ: only its own server lists them.
afterEach(() => {
  vi.unstubAllEnvs();
});

// Records the filters a query gets.
const query = () => {
  const calls: unknown[][] = [];
  const q = { calls, not: (...args: unknown[]) => (calls.push(args), q) };
  return q;
};

describe("the e2e suite's test data", () => {
  it('is left out everywhere unless the test server asks for it', () => {
    expect(publicVisibilities()).toEqual(['public']);
    expect(allVisibilities()).toEqual(['public', 'private']);
    expect(newEventVisibility('public')).toBe('public');
    expect(newEventVisibility('private')).toBe('private');
    expect(hideTestRows(query()).calls).toEqual([['first_name', 'like', 'ZZZ%']]);
  });

  it('shows on the test server, where every new event is a test one', () => {
    vi.stubEnv('E2E_TEST_EVENTS', '1');
    expect(publicVisibilities()).toEqual(['public', 'test']);
    expect(allVisibilities()).toEqual(['public', 'private', 'test']);
    expect(newEventVisibility('public')).toBe('test');
    expect(newEventVisibility('private')).toBe('test');
    expect(hideTestRows(query()).calls).toEqual([]);
  });
});
