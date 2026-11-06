import { env } from './env';
import { fakeQrServices } from './testMode';

// The branded QR site (qr.dancewithb.fun), reached as the author "Dance With B"
// with QR_API_TOKEN (a server-only secret). It keeps short links (/c/<code>)
// that redirect wherever they're pointed, and saved branded codes. Each saved
// door sign (lib/doorSigns.ts) has its own link; branded codes are made in the
// site's generator, several links at a time (batchUrl). See
// https://qr.dancewithb.fun/api.

export interface ShortLink {
  code: string;
  short: string;
  url: string;
  label: string;
  key: string | null;
  hits: number;
  created_at: number;
  // Unix seconds; equals created_at until the link is first repointed.
  updated_at: number;
  last_hit: number | null;
  // Scans per day, oldest first, ending today in `tz` (only when asked for).
  stats?: { tz: string; days: { date: string; hits: number }[] };
}

export interface SavedCode {
  id: number;
  name: string;
  created_at: number;
  // The code's image: needs no token, works as an <img src>.
  svg_url: string;
  link: { code: string; short: string; url: string | null } | null;
  // The generator settings it was made with (contrast "0.56" is Vivid colours).
  meta?: { settings?: { contrast?: string } };
}

// Codes the site makes use the generator's "Vivid colours" contrast.
export const VIVID = '0.56';
export const isVivid = (code: Pick<SavedCode, 'meta'>) => code.meta?.settings?.contrast === VIVID;

export class BrandedQrError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // On a 409: the link as it is now.
    readonly link: ShortLink | null = null
  ) {
    super(message);
  }
}

const base = () => (env('QR_API_BASE') || 'https://qr.dancewithb.fun').replace(/\/$/, '');
const TIMEOUT_MS = 10_000;
const SVG_CACHE_MS = 5 * 60 * 1000;
const CODES_CACHE_MS = 60 * 1000;

export const brandedQrConfigured = () => fakeQrServices() || Boolean(env('QR_API_TOKEN'));

async function call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  if (fakeQrServices()) return fake(method, body) as T;
  const token = env('QR_API_TOKEN');
  if (!token) throw new BrandedQrError("The QR site isn't connected: set QR_API_TOKEN in Netlify.", 503);
  let res: Response;
  try {
    res = await fetch(`${base()}/api/${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new BrandedQrError("Couldn't reach qr.dancewithb.fun. Try again in a moment.", 502);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string; link?: ShortLink } | null;
    const why = res.status === 401 ? 'the QR_API_TOKEN was refused (rotated or revoked?)' : (data?.error ?? `status ${res.status}`);
    const status = res.status === 404 || res.status === 409 ? res.status : 502;
    throw new BrandedQrError(`qr.dancewithb.fun: ${why}`, status, data?.link ?? null);
  }
  return (await res.json()) as T;
}

const notFound = (err: unknown) => err instanceof BrandedQrError && err.status === 404;

// Every link of this author, a page of 200 at a time (up to 2,000).
const LINKS_PAGE = 200;
export async function listLinks(): Promise<ShortLink[]> {
  const all: ShortLink[] = [];
  for (let offset = 0; offset < 2000; offset += LINKS_PAGE) {
    const { links } = await call<{ links: ShortLink[] }>('link.read', { limit: LINKS_PAGE, offset });
    all.push(...links);
    if (links.length < LINKS_PAGE) break;
  }
  return all;
}

// One link, by its code; with `stats`, its scans per day for the last 7 days in `tz`.
export async function readLink(code: string, stats?: { tz: string; days?: number }): Promise<ShortLink | null> {
  try {
    return await call<ShortLink>('link.read', { code, ...(stats ? { stats: true, tz: stats.tz, days: stats.days ?? 7 } : {}) });
  } catch (err) {
    if (notFound(err)) return null;
    throw err;
  }
}

// A link made with a key comes back unchanged when it already exists, so a retry never makes two.
export const createLink = (url: string, label: string, key: string) => call<ShortLink>('link.create', { url, label, key });

// Repoints a link, only if it still opens `ifUrl` (a 409 BrandedQrError with the link as it is now if not).
export const pointLink = (code: string, url: string, ifUrl?: string | null) => call<ShortLink>('link.update', { code, url, ...(ifUrl ? { if_url: ifUrl } : {}) });

// Saved codes that open this short link, newest first. Kept for a minute, as
// every page load asks; `fresh` asks the site again (after codes were made).
const codesCache = new Map<string, { codes: SavedCode[]; at: number }>();
export async function codesFor(linkCode: string, fresh = false): Promise<SavedCode[]> {
  const hit = codesCache.get(linkCode);
  if (!fresh && hit && Date.now() - hit.at < CODES_CACHE_MS) return hit.codes;
  const { designs } = await call<{ designs: SavedCode[] }>('qr.read', { link: linkCode, limit: 20 });
  codesCache.set(linkCode, { codes: designs, at: Date.now() });
  return designs;
}

// The generator, making branded codes for several links at once (1 to 25),
// in the look of code `from`; it offers to come back to `returnUrl` with
// ?qr_ids=<link>:<code id>,… once they're saved.
export const MAX_BATCH = 25;
export function batchUrl(linkCodes: string[], from: number | null, returnUrl: string): string {
  const params = new URLSearchParams({ batch: linkCodes.slice(0, MAX_BATCH).join(','), name: 'Door sign {code}', contrast: VIVID, return: returnUrl });
  if (from) params.set('from', String(from));
  return `${base()}/?${params.toString().replace(/%2C/g, ',').replace(/%7B/g, '{').replace(/%7D/g, '}')}`;
}

// The generator, embedded in /admin/qr: a ticket (made here with the author
// token, which never reaches the browser) lets the iframe at `url` make one
// code per link and nothing else, for 10 minutes. It tells the page how it went
// with postMessage from `embedOrigin()`. `parent` must be an origin the QR site
// allows (dancewithb.fun, or localhost:4321 for the dev server).
export interface Ticket {
  url: string;
  expires_at: number;
}
// Always in Vivid colours; with `replace`, links that already have a code get a new one
// and their old codes are deleted (so `from` may be gone afterwards).
export async function createTicket(linkCodes: string[], from: number | null, parent: string, replace = false): Promise<Ticket> {
  if (fakeQrServices()) return { url: `${parent}/api/fake-qr-embed?links=${encodeURIComponent(linkCodes.join(','))}&parent=${encodeURIComponent(parent)}${replace ? '&replace=1' : ''}`, expires_at: Math.floor(Date.now() / 1000) + 600 };
  return call<Ticket>('ticket.create', { links: linkCodes.slice(0, MAX_BATCH), name: 'Door sign {code}', parent, settings: { contrast: VIVID }, ...(from ? { from } : {}), ...(replace ? { replace: true } : {}) });
}
// Where the embedded generator's messages come from (the test suite's stand-in is served by this site).
export const embedOrigin = (siteOrigin: string) => (fakeQrServices() ? siteOrigin : new URL(base()).origin);

// Anything in an SVG that could run script if it were ever opened as a page.
const ACTIVE_SVG = /<script|<foreignObject|<iframe|<embed|<object|\son[a-z]+\s*=|javascript:/i;

// A saved code's SVG, fetched by this server for the sign's PNG (a canvas can't
// draw another site's image unless that site allows it).
const svgCache = new Map<string, { svg: string; at: number }>();
export async function codeSvg(svgUrl: string): Promise<string> {
  const hit = svgCache.get(svgUrl);
  if (hit && Date.now() - hit.at < SVG_CACHE_MS) return hit.svg;
  let svg: string;
  if (fakeQrServices()) svg = FAKE_SVG;
  else {
    if (!svgUrl.startsWith(`${base()}/q/`)) throw new BrandedQrError("That isn't one of qr.dancewithb.fun's codes.", 400);
    const res = await fetch(svgUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
    if (!res?.ok) throw new BrandedQrError("Couldn't load the branded code from qr.dancewithb.fun.", 502);
    svg = await res.text();
  }
  if (!svg.trimStart().startsWith('<svg')) throw new BrandedQrError('qr.dancewithb.fun sent something other than an SVG.', 502);
  if (ACTIVE_SVG.test(svg)) throw new BrandedQrError('That branded code has scripts in it, so the sign won’t use it. Make it again in the generator.', 502);
  svgCache.set(svgUrl, { svg, at: Date.now() });
  return svg;
}

// ---- The test suite's stand-in (E2E_FAKE_QR), kept in this server's memory ----

const fakeState = { links: [] as ShortLink[], codes: [] as SavedCode[], nextId: 1 };
const FAKE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="#fff"/><rect x="1" y="1" width="7" height="7" fill="#e0457b"/></svg>';
const FAKE_SVG_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(FAKE_SVG)}`;

// What the generator's batch does: a code for each link that has none. Returns "link:id" pairs.
export function fakeBatch(linkCodes: string[], replace = false, contrast = VIVID): string[] {
  return linkCodes.map((code) => {
    const link = fakeState.links.find((l) => l.code === code)!;
    if (replace) fakeState.codes = fakeState.codes.filter((c) => c.link?.code !== code);
    let made = fakeState.codes.find((c) => c.link?.code === code);
    if (!made) {
      made = { id: fakeState.nextId++, name: `Door sign ${code}`, created_at: Math.floor(Date.now() / 1000), svg_url: FAKE_SVG_URL, link: { code, short: link.short, url: link.url }, meta: { settings: { contrast } } };
      fakeState.codes.push(made);
    }
    return `${code}:${made.id}`;
  });
}

function fake(method: string, body: Record<string, unknown>): unknown {
  const now = Math.floor(Date.now() / 1000);
  const link = (code: unknown) => fakeState.links.find((l) => l.code === code);
  const gone = () => new BrandedQrError('qr.dancewithb.fun: no such link', 404);
  switch (method) {
    case 'link.read': {
      if (!body.code) return { links: [...fakeState.links].reverse() };
      const found = link(body.code);
      if (!found) throw gone();
      return body.stats ? { ...found, stats: { tz: body.tz, days: [{ date: '2026-01-01', hits: 0 }] } } : found;
    }
    case 'link.create': {
      const existing = fakeState.links.find((l) => l.key === body.key);
      if (existing) return existing;
      const code = `t${fakeState.links.length + 1}`;
      const made: ShortLink = { code, short: `https://qr.example.test/c/${code}`, url: String(body.url), label: String(body.label ?? ''), key: String(body.key), hits: 0, created_at: now, updated_at: now, last_hit: null };
      fakeState.links.push(made);
      return made;
    }
    case 'link.update': {
      const found = link(body.code);
      if (!found) throw gone();
      if (body.if_url && body.if_url !== found.url) throw new BrandedQrError('qr.dancewithb.fun: the link points somewhere else now', 409, { ...found });
      found.url = String(body.url);
      found.updated_at = now;
      return found;
    }
    case 'qr.read':
      return { designs: fakeState.codes.filter((c) => c.link?.code === body.link).reverse() };
    default:
      throw new BrandedQrError(`qr.dancewithb.fun: ${method} isn't faked`, 500);
  }
}
