import { fakeShortLinkHit, qrSiteBase } from './brandedQr';
import { signForLink } from './doorSigns';
import { isLinkPreviewBot } from './linkPreviewBot';
import { loadQrStudio } from './qrStudioStore';
import { SITE_URL } from './seoSchema';
import { logSiteError } from './siteErrors';
import { fakeQrServices } from './testMode';

// Short links on this site (/c/<code>, pages/c/[code].ts). A door sign's code
// opens dancewithb.fun/c/<code>, so on Android it opens the installed app
// (whose scope is this site); the QR site (qr.dancewithb.fun) still keeps the
// links, says where each goes and counts the scans. This asks it, and when it
// can't be reached falls back to where this site last pointed the code.

// A code as the QR site writes them (its worker's decodeCode): 1 to 9 of a-z
// and 0-9, read in any case. Anything else is no code at all.
const CODE = /^[a-z0-9]{1,9}$/;
export function cleanShortCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toLowerCase();
  return CODE.test(code) ? code : null;
}

// This site's address for a code: what the door sign page shows and copies.
export const siteShortLink = (origin: string, code: string) => `${origin.replace(/\/$/, '')}/c/${code}`;

// A browser copies the scanned link's #fragment (QR codes use it to shape
// their pattern) onto a redirect with none, so the target gets an explicit,
// empty one, as the QR site does.
export const withEmptyFragment = (url: string) => (url.includes('#') ? url : `${url}#`);

const isWebUrl = (url: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

// The host the QR site is told the scan came through (X-Short-Link-Host). It
// compares it with the address its owner set up (dancewithb.fun), so it is
// always the site's own host, whatever host this request came in on (www, a
// Netlify deploy preview or branch); the test server's own, as the fake is.
export const shortLinkHost = (requestHost: string) => (fakeQrServices() ? requestHost : new URL(import.meta.env.SITE || SITE_URL).host);

export const QR_SITE_TIMEOUT_MS = 3000;

export type QrSiteAnswer = { kind: 'redirect'; location: string } | { kind: 'missing' } | { kind: 'failed'; reason: string };

// Where the QR site says a code goes. `count`: GET, a scan it counts; else HEAD,
// which it answers the same without counting. `host` (shortLinkHost) lets it
// refuse another owner's codes. `fakeDown`: the test server's outage switch.
export async function askQrSite(code: string, opts: { count: boolean; host: string; fakeDown?: string | null }): Promise<QrSiteAnswer> {
  const method = opts.count ? 'GET' : 'HEAD';
  let res: Response;
  try {
    res = fakeQrServices()
      ? fakeShortLinkHit(code, method, opts.fakeDown ?? null)
      : await fetch(`${qrSiteBase()}/c/${code}`, { method, redirect: 'manual', headers: { 'X-Short-Link-Host': opts.host }, signal: AbortSignal.timeout(QR_SITE_TIMEOUT_MS) });
  } catch (err) {
    const e = err as Error;
    return { kind: 'failed', reason: e.name === 'TimeoutError' || e.name === 'AbortError' ? `no answer within ${QR_SITE_TIMEOUT_MS / 1000} s` : `couldn't connect (${e.message})` };
  }
  res.body?.cancel().catch(() => {});
  const location = res.headers.get('Location');
  if (res.status >= 300 && res.status < 400 && location && isWebUrl(location)) return { kind: 'redirect', location };
  if (res.status === 404) return { kind: 'missing' };
  return { kind: 'failed', reason: `status ${res.status}` };
}

// Where this site last pointed a code: its door sign's address, or the first
// check-in link's (remembered on site_config.qr_studio before signs existed).
export async function savedDestination(code: string): Promise<string | null> {
  const [sign, studio] = await Promise.all([signForLink(code).catch(() => null), loadQrStudio().then((s) => s.studio).catch(() => null)]);
  const legacy = studio?.checkin?.code === code ? studio.checkin.pointedUrl : null;
  const url = sign?.pointed_url ?? legacy;
  return url && isWebUrl(url) ? withEmptyFragment(url) : null;
}

// One line on the Errors workqueue per code while it keeps failing (repeats
// add to its count). The test server only logs it, keeping the live list clean.
async function reportFailure(code: string, reason: string, fallback: string | null): Promise<void> {
  const message = `Couldn't ask ${new URL(qrSiteBase()).host} where /c/${code} goes (${reason}); ${fallback ? 'sent the scan to the address this site last pointed it at' : 'the scan was told to try again'}.`;
  console.error(message);
  if (!fakeQrServices()) await logSiteError('short_link', message, { details: { code, reason, fallback }, dedupeKey: `short_link:${code}` });
}

export type ShortLinkOutcome = { kind: 'redirect'; location: string } | { kind: 'missing' } | { kind: 'unavailable' };

// A short link, start to end. Link-preview bots and HEAD requests aren't counted.
export async function resolveShortLink(code: string, req: { method: string; userAgent: string | null; host: string; fakeDown?: string | null }): Promise<ShortLinkOutcome> {
  const count = req.method === 'GET' && !isLinkPreviewBot(req.userAgent);
  const answer = await askQrSite(code, { count, host: shortLinkHost(req.host), fakeDown: req.fakeDown });
  if (answer.kind !== 'failed') return answer;
  const fallback = await savedDestination(code);
  await reportFailure(code, answer.reason, fallback);
  return fallback ? { kind: 'redirect', location: fallback } : { kind: 'unavailable' };
}
