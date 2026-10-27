import { promises as dns } from 'node:dns';

// Whether an email domain can receive mail at all: it has mail servers (MX
// records), or at least an address mail can fall back to. Catches made-up or
// misspelled domains (gmial.com, yaho.com) when someone types their email.
// Fails open: a lookup that times out or errors for any other reason counts
// as fine, so a DNS hiccup never stands in anyone's way.

const LOOKUP_TIMEOUT_MS = 2500;
const CACHE_MS = 60 * 60 * 1000;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

// Bounded, since anyone can ask about any domain: oldest entries go first.
export const CACHE_MAX = 1000;
const cache = new Map<string, { ok: boolean; at: number }>();

export const domainCacheSize = () => cache.size;

function remember(domain: string, ok: boolean) {
  cache.delete(domain);
  if (cache.size >= CACHE_MAX) {
    const now = Date.now();
    for (const [d, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(d);
    while (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  cache.set(domain, { ok, at: Date.now() });
}

// Errors that mean the domain or its mail records don't exist.
const MISSING = new Set(['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN', 'ESERVFAIL_NX']);

async function hasRecords(lookup: () => Promise<unknown[]>): Promise<boolean | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      lookup(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), LOOKUP_TIMEOUT_MS);
      }),
    ]);
    return records.length > 0;
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    return MISSING.has(code) ? false : null;
  } finally {
    clearTimeout(timer);
  }
}

export async function domainAcceptsMail(rawDomain: string): Promise<boolean> {
  const domain = rawDomain.trim().toLowerCase().replace(/\.$/, '');
  if (!DOMAIN_RE.test(domain)) return false;
  const cached = cache.get(domain);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.ok;

  const mx = await hasRecords(() => dns.resolveMx(domain));
  let ok: boolean;
  if (mx !== false) {
    ok = true; // has mail servers, or the lookup failed for another reason
  } else {
    // No MX: mail falls back to the domain's own address, if it has one.
    const a = await hasRecords(() => dns.resolve4(domain));
    const aaaa = a ? true : await hasRecords(() => dns.resolve6(domain));
    ok = a !== false || aaaa !== false;
  }
  remember(domain, ok);
  return ok;
}
