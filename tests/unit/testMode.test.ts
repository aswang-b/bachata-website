import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminVisibilities, publicVisibilities } from '../../src/lib/testMode';

// The e2e suite's classes are saved with visibility 'test': only its own server lists them.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the e2e suite's 'test' classes", () => {
  it('are left out everywhere unless the test server asks for them', () => {
    expect(publicVisibilities()).toEqual(['public']);
    expect(adminVisibilities()).toEqual(['public', 'private']);
  });

  it('show as public, and to admins, on the test server', () => {
    vi.stubEnv('E2E_TEST_EVENTS', '1');
    expect(publicVisibilities()).toEqual(['public', 'test']);
    expect(adminVisibilities()).toEqual(['public', 'private', 'test']);
  });
});
