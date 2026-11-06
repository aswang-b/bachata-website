import { env } from './env';
import { fakeQrServices } from './testMode';

// The branded QR site (qr.dancewithb.fun), reached as the author "Dance With B"
// with QR_API_TOKEN (a server-only secret). It keeps short links (/c/<code>)
// that redirect wherever they're pointed, and saved branded codes. Branded
// designs are generated in its browser generator, so this site only creates
// the check-in short link, lists the codes saved for it, fetches their SVGs
// and repoints the link. See https://qr.dancewithb.fun/api.

export interface ShortLink {
  code: string;
  short: string;
  url: string;
  label: string;
  hits: number;
  last_hit: number | null;
}

export interface SavedCode {
  id: number;
  name: string;
  created_at: number;
  link: { code: string; short: string; url: string } | null;
}

export class BrandedQrError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const base = () => (env('QR_API_BASE') || 'https://qr.dancewithb.fun').replace(/\/$/, '');
const TIMEOUT_MS = 10_000;
const SVG_CACHE_MS = 5 * 60 * 1000;
const CODES_CACHE_MS = 60 * 1000;

export const brandedQrConfigured = () => fakeQrServices() || Boolean(env('QR_API_TOKEN'));
export const generatorUrl = (short: string) => `${base()}/?text=${encodeURIComponent(short)}`;

async function call<T>(method: string, body: Record<string, unknown> = {}, raw = false): Promise<T> {
  if (fakeQrServices()) return fake(method, body) as T;
  const token = env('QR_API_TOKEN');
  if (!token) throw new BrandedQrError('The QR site isn\'t connected: set QR_API_TOKEN in Netlify.', 503);
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
    const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    const why = res.status === 401 ? 'the QR_API_TOKEN was refused (rotated or revoked?)' : (error ?? `status ${res.status}`);
    throw new BrandedQrError(`qr.dancewithb.fun: ${why}`, res.status === 404 ? 404 : 502);
  }
  return (raw ? await res.text() : await res.json()) as T;
}

export async function listLinks(): Promise<ShortLink[]> {
  return (await call<{ links: ShortLink[] }>('link.read', { limit: 200 })).links;
}

export async function readLink(code: string): Promise<ShortLink | null> {
  try {
    return await call<ShortLink>('link.read', { code });
  } catch (err) {
    if (err instanceof BrandedQrError && err.status === 404) return null;
    throw err;
  }
}

export const createLink = (url: string, label: string) => call<ShortLink>('link.create', { url, label });
export const pointLink = (code: string, url: string) => call<ShortLink>('link.update', { code, url });

// Saved codes that open this short link, newest first. Kept for a minute, as
// every page load and every branded code asks; `fresh` asks the site again
// (after a new code was saved in the generator).
const codesCache = new Map<string, { codes: SavedCode[]; at: number }>();
export async function codesFor(linkCode: string, fresh = false): Promise<SavedCode[]> {
  const hit = codesCache.get(linkCode);
  if (!fresh && hit && Date.now() - hit.at < CODES_CACHE_MS) return hit.codes;
  const { designs } = await call<{ designs: SavedCode[] }>('qr.read', { limit: 200 });
  const codes = designs.filter((d) => d.link?.code === linkCode);
  codesCache.set(linkCode, { codes, at: Date.now() });
  return codes;
}

// Anything in an SVG that could run script if it were ever opened as a page.
const ACTIVE_SVG = /<script|<foreignObject|<iframe|<embed|<object|\son[a-z]+\s*=|javascript:/i;

// A saved code's SVG; `fresh` skips the cache (the design may have been re-saved).
const svgCache = new Map<number, { svg: string; at: number }>();
export async function codeSvg(id: number, fresh = false): Promise<string> {
  const hit = svgCache.get(id);
  if (!fresh && hit && Date.now() - hit.at < SVG_CACHE_MS) return hit.svg;
  const svg = await call<string>('qr.read', { id, format: 'svg' }, true);
  if (!svg.trimStart().startsWith('<svg')) throw new BrandedQrError('qr.dancewithb.fun sent something other than an SVG.', 502);
  if (ACTIVE_SVG.test(svg)) throw new BrandedQrError('That branded code has scripts in it, so the sign won’t use it. Save it again in the generator.', 502);
  svgCache.set(id, { svg, at: Date.now() });
  return svg;
}

// ---- The test suite's stand-in (E2E_FAKE_QR), kept in this server's memory ----

const fakeState = { links: [] as ShortLink[], codes: [] as (SavedCode & { svg: string })[] };
const FAKE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="#fff"/><rect x="1" y="1" width="7" height="7" fill="#e0457b"/></svg>';

function fake(method: string, body: Record<string, unknown>): unknown {
  const link = (code: unknown) => fakeState.links.find((l) => l.code === code);
  switch (method) {
    case 'link.read':
      if (body.code) {
        const found = link(body.code);
        if (!found) throw new BrandedQrError('qr.dancewithb.fun: no such link', 404);
        return found;
      }
      return { links: [...fakeState.links].reverse() };
    case 'link.create': {
      const code = `t${fakeState.links.length + 1}`;
      const made: ShortLink = { code, short: `https://qr.example.test/c/${code}`, url: String(body.url), label: String(body.label ?? ''), hits: 0, last_hit: null };
      fakeState.links.push(made);
      // As if the admin then saved a branded code for it in the generator.
      fakeState.codes.push({ id: fakeState.codes.length + 1, name: 'Test branded code', created_at: Math.floor(Date.now() / 1000), link: { code, short: made.short, url: made.url }, svg: FAKE_SVG });
      return made;
    }
    case 'link.update': {
      const found = link(body.code);
      if (!found) throw new BrandedQrError('qr.dancewithb.fun: no such link', 404);
      found.url = String(body.url);
      return found;
    }
    case 'qr.read':
      if (body.id) {
        const code = fakeState.codes.find((c) => c.id === Number(body.id));
        if (!code) throw new BrandedQrError('qr.dancewithb.fun: no such code', 404);
        return code.svg;
      }
      return { designs: fakeState.codes.map(({ svg: _svg, ...rest }) => rest).reverse() };
    default:
      throw new BrandedQrError(`qr.dancewithb.fun: ${method} isn't faked`, 500);
  }
}
