import { describe, expect, it, vi } from 'vitest';

vi.mock('node:dns', () => ({
  promises: {
    resolveMx: async (domain: string) => (domain.startsWith('nomail') ? Promise.reject(Object.assign(new Error('x'), { code: 'ENOTFOUND' })) : [{ exchange: 'mx' }]),
    resolve4: async () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOTFOUND' })),
    resolve6: async () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOTFOUND' })),
  },
}));

import { CACHE_MAX, domainAcceptsMail, domainCacheSize } from '../../src/lib/emailDomain';

describe('email domain check (/api/email-domain)', () => {
  it('knows a domain with mail servers from one without', async () => {
    expect(await domainAcceptsMail('example.com')).toBe(true);
    expect(await domainAcceptsMail('nomail-example.com')).toBe(false);
  });

  it("keeps its cache bounded however many different domains it's asked about", async () => {
    for (let i = 0; i < CACHE_MAX + 50; i++) await domainAcceptsMail(`random-${i}.com`);
    expect(domainCacheSize()).toBeLessThanOrEqual(CACHE_MAX);
    // The newest answers are still cached.
    expect(await domainAcceptsMail(`random-${CACHE_MAX + 49}.com`)).toBe(true);
  });
});
