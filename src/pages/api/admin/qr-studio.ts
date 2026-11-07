import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { CheckinLinkError, buildCheckinLink, eventIdsFrom } from '../../../lib/checkinLink';
import { BrandedQrError, MAX_BATCH, batchUrl, cleanCodeStyle, brandedQrConfigured, codeSvg, codesFor, createTicket, embedOrigin, isVivid, pointLink, readLink } from '../../../lib/brandedQr';
import { DEFAULT_CHECKIN_TITLE, DoorSignError, MAX_SIGNS, nameTaken, signNamed, SPARE_LINKS, addPoolLink, deleteSign, getSign, insertSign, listSigns, poolLinks, updateSign, type DoorSign, type SignVenmo } from '../../../lib/doorSigns';
import { QrStudioStoreError, loadQrStudio, updateQrStudio, type QrStudio } from '../../../lib/qrStudioStore';
import { siteTimeZone } from '../../../lib/siteTime';
import { VenmoLookupError, cleanVenmoUsername, lookupVenmo, venmoCodeUrl, venmoProfileUrl } from '../../../lib/venmo';
import { fakeQrServices } from '../../../lib/testMode';

export const prerender = false;

// Door signs on /admin/qr. Each saved sign (lib/doorSigns.ts) has its own
// short link on qr.dancewithb.fun, pointed at its classes, and a branded code
// made for that link in the QR site's generator.
//
// GET → saved signs (each with its link: where it opens, scans per day this
// week, and its branded code), the Venmo accounts, and how many signs still
// need a branded code; ?fresh=1 skips the minute-long cache of codes;
// ?svg=<sign id> → that sign's branded code as an SVG, for the PNG download.
// POST 'preview' { eventIds, createRegistration } → the plain check-in address
// for an unsaved pick; 'save' { id?, heading, checkinTitle, eventIds, createRegistration,
// showClasses, venmo: { username, label } | null, confirm? } saves a sign
// (409 { error: 'confirm', pointedAt } when it moves a link pointed elsewhere
// in the last 6 hours, unless confirm; 409 { error: 'changed', opens } when the
// link was repointed on the QR site meanwhile; a heading is needed, and is the
// sign's name, so another sign's is refused with 409 before anything changes); 'delete' { id } frees its link;
// 'codes' { remake? } → a ticket for the embedded generator (`embed: { url, origin, links }`)
// that makes branded codes for every sign (and spare link) without one, and
// the full-page generator's address (`url`) as the fallback; with remake, for
// codes not yet in Vivid colours instead (no fallback); with signId, a new code
// for that sign alone, in its look or a picked `style` { shape, eyes } (the old
// one is deleted; its short link, and so printed copies, stay the same); 'venmo-find' { username }; 'venmo-save'
// { username, label }, 'venmo-remove' { username }, 'venmo-default' { username }.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
// Repointing a sign's link within this long of the last time, to somewhere else, asks first.
const RECENT_MS = 6 * 60 * 60 * 1000;
const JUST_MADE_MS = 30 * 60 * 1000;
const MAX_VENMO = 30;
const MAX_LABEL = 60;
const MAX_HEADING = 60;
const MAX_CHECKIN_TITLE = 40;
// It comes from another site: never run anything in it, even if opened directly.
const SVG_HEADERS = {
  'Content-Type': 'image/svg+xml',
  'Cache-Control': 'private, max-age=300',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
  'X-Content-Type-Options': 'nosniff',
};

// Check-in links go to the live site (phones can't open a dev server), except in the test suite.
const siteOrigin = (request: Request) => (fakeQrServices() ? new URL(request.url).origin : (import.meta.env.SITE ?? 'https://dancewithb.fun').replace(/\/$/, ''));

const withLinks = <T extends { username: string; userId: string }>(a: T) => ({ ...a, codeUrl: venmoCodeUrl(a.userId), profileUrl: venmoProfileUrl(a.username) });
const venmoState = (studio: QrStudio) => ({ venmo: studio.venmo.map(withLinks), defaultVenmo: studio.defaultVenmo });

// A saved sign as the page shows it: where its link opens now, its scans this week, its branded code.
async function signView(sign: DoorSign, fresh: boolean) {
  const view = { ...sign, venmo: sign.venmo ? withLinks(sign.venmo) : null };
  try {
    const [link, codes] = await Promise.all([readLink(sign.link_code, { tz: siteTimeZone(), days: 7 }), codesFor(sign.link_code, fresh)]);
    const code = codes[0] ?? null;
    return {
      ...view,
      link: link ? { code: link.code, short: link.short, url: link.url, hits: link.hits, updatedAt: link.updated_at, week: link.stats?.days ?? [] } : null,
      code: code ? { id: code.id, name: code.name, svgUrl: code.svg_url, vivid: isVivid(code), style: cleanCodeStyle(code.meta?.settings) } : null,
    };
  } catch (err) {
    return { ...view, link: null, code: null, error: (err as Error).message };
  }
}

// `fresh`: true asks the QR site again about every sign's codes; a sign id, only about that one (just saved).
async function state(fresh: boolean | string = false): Promise<Record<string, unknown>> {
  const { studio, saved } = await loadQrStudio();
  const connected = brandedQrConfigured();
  const base = { saved, connected, ...venmoState(studio), signs: [] as unknown[], signsError: null as string | null, standardCodes: 0 };
  if (!connected) return base;
  let signs: DoorSign[];
  try {
    signs = await listSigns();
  } catch (err) {
    base.signsError = (err as Error).message;
    return base;
  }
  // Each sign stays on the page (with its plain code) even when the QR site can't be reached.
  base.signs = await Promise.all(signs.map((s) => signView(s, fresh === true || fresh === s.id)));
  try {
    // Codes made before they were all vivid (signs' and spares'), which can be remade. Mostly cached by now.
    const pool = await poolLinks(signs);
    const codes = await Promise.all(pool.links.map((l) => codesFor(l.code)));
    base.standardCodes = codes.filter((c) => c[0] && !isVivid(c[0])).length;
  } catch {
    // Only the "make them vivid" count is missing.
  }
  return base;
}

function failure(err: unknown): Response {
  if (err instanceof CheckinLinkError || err instanceof BrandedQrError || err instanceof DoorSignError) return json({ error: err.message }, err.status);
  if (err instanceof VenmoLookupError) return json({ error: err.message }, 400);
  if (err instanceof QrStudioStoreError) return json({ error: err.message }, 500);
  console.error('Door signs failed:', err);
  return json({ error: 'Something went wrong.' }, 500);
}

// The Venmo account a sign shows: a remembered one, or anyone else looked up on Venmo.
async function signVenmo(raw: unknown): Promise<SignVenmo | null> {
  const r = raw as { username?: unknown; label?: unknown } | null;
  if (!r) return null;
  const username = cleanVenmoUsername(r.username);
  if (!username) throw new VenmoLookupError('That Venmo username has letters, numbers, - and _ only.');
  const label = typeof r.label === 'string' ? r.label.trim().slice(0, MAX_LABEL) : '';
  const { studio } = await loadQrStudio();
  const known = studio.venmo.find((a) => a.username.toLowerCase() === username.toLowerCase());
  const account = known ?? (await lookupVenmo(username));
  return { username: account.username, name: account.name, userId: account.userId, label: label || (known?.label ?? '') };
}

async function save(request: Request, body: Record<string, unknown>): Promise<Response> {
  const link = await buildCheckinLink(siteOrigin(request), eventIdsFrom(body), body.createRegistration === true);
  const heading = typeof body.heading === 'string' ? body.heading.trim().slice(0, MAX_HEADING) : '';
  if (!heading) throw new DoorSignError('Give the sign a heading: it’s also its name in Saved signs.');
  // Checked before any link is pointed, so a refused name changes nothing (the database checks again on saving).
  if (await signNamed(heading, typeof body.id === 'string' ? body.id : undefined)) throw nameTaken(heading);
  const checkinTitle = typeof body.checkinTitle === 'string' ? body.checkinTitle.trim().slice(0, MAX_CHECKIN_TITLE) : '';
  const fields = {
    heading,
    checkin_title: checkinTitle || DEFAULT_CHECKIN_TITLE,
    event_ids: link.events.map((e) => e.id),
    titles: link.events.map((e) => e.title),
    create_registration: link.createRegistration,
    show_classes: body.showClasses !== false,
    venmo: await signVenmo(body.venmo),
  };
  if (!brandedQrConfigured()) throw new DoorSignError('Saving signs needs the QR site: set QR_API_TOKEN in Netlify.', 503);

  // A new sign takes a free link from the pool, or a new one.
  if (typeof body.id !== 'string') {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { links, free } = await poolLinks();
      if (links.length - free.length >= MAX_SIGNS) throw new DoorSignError(`Delete a sign first: up to ${MAX_SIGNS} can be saved.`);
      let target;
      try {
        target = free[0] ? await pointLink(free[0].code, link.url, free[0].url) : await addPoolLink(link.url, links);
      } catch (err) {
        // Another save took that link first: try again with the next one.
        if (err instanceof BrandedQrError && err.status === 409) continue;
        throw err;
      }
      const sign = await insertSign({ ...fields, link_code: target.code, link_short: target.short, pointed_url: link.url });
      if (sign) return json({ saved: sign.id, state: await state(sign.id) });
    }
    throw new DoorSignError('Another sign was saved at the same moment. Try again.', 409);
  }

  const sign = await getSign(body.id);
  if (!sign) throw new DoorSignError('That sign was deleted.', 404);
  const current = await readLink(sign.link_code);
  if (!current) throw new DoorSignError(`Its short link ${sign.link_short} was deleted on the QR site. Delete this sign and save it again.`, 409);
  if (current.url !== link.url) {
    const pointedAt = current.updated_at * 1000;
    // A sign made in the last half hour is still being set up, not printed: no need to ask.
    const justMade = Date.now() - Date.parse(sign.created_at) < JUST_MADE_MS;
    if (!justMade && Date.now() - pointedAt < RECENT_MS && body.confirm !== true) return json({ error: 'confirm', pointedAt: new Date(pointedAt).toISOString() }, 409);
    try {
      await pointLink(sign.link_code, link.url, current.url);
    } catch (err) {
      if (err instanceof BrandedQrError && err.status === 409) return json({ error: 'changed', opens: err.link?.url ?? null }, 409);
      throw err;
    }
  }
  await updateSign(sign.id, { ...fields, pointed_url: link.url });
  return json({ saved: sign.id, state: await state(sign.id) });
}

// The generator address that makes branded codes for every pool link without
// one, keeping a couple of spare links ready so the next new signs have codes too.
// With `remake`: instead, every pool link whose code isn't in Vivid colours gets a new one (the old is deleted).
async function codesUrl(request: Request, remake = false): Promise<Response> {
  const origin = siteOrigin(request);
  let { links, free } = await poolLinks();
  // Spare links only when making codes; a remake only redoes existing ones.
  for (let i = free.length; !remake && i < SPARE_LINKS; i++) {
    const spare = await addPoolLink(`${origin}/check-in`, links);
    links = [...links, spare];
    free = [...free, spare];
  }
  const codes = await Promise.all(links.map(async (l) => ({ link: l, codes: await codesFor(l.code, true) })));
  const missing = codes.filter((c) => (remake ? c.codes[0] && !isVivid(c.codes[0]) : c.codes.length === 0)).map((c) => c.link.code);
  if (missing.length === 0) return json({ error: remake ? 'Every branded code is already in vivid colours.' : 'Every sign already has its branded code.' }, 409);
  // The newest code in the pool sets the look of the new ones.
  const from = codes.flatMap((c) => c.codes).sort((a, b) => b.created_at - a.created_at)[0]?.id ?? null;
  const here = new URL(request.url).origin;
  // The full page can't remake codes, so a remake has no fallback.
  const fallback = remake ? null : batchUrl(missing, from, `${here}/admin/qr`);
  // The generator embedded in this page; if the QR site won't make a ticket
  // for this address (only dancewithb.fun and the dev server are allowed), the full page instead.
  try {
    const ticket = await createTicket(missing, from, here, remake);
    return json({ embed: { url: ticket.url, origin: embedOrigin(here), links: missing.slice(0, MAX_BATCH) }, url: fallback });
  } catch (err) {
    console.error('QR ticket failed:', (err as Error).message);
    return json({ url: fallback });
  }
}

// A new branded code for one saved sign, in the embedded generator: in its
// current look (from its code) with any picked style over it. The old code is
// deleted once the new one is saved; the short link doesn't change.
async function newCodeFor(request: Request, signId: string, rawStyle: unknown): Promise<Response> {
  const sign = await getSign(signId);
  if (!sign) throw new DoorSignError('That sign was deleted.', 404);
  const current = (await codesFor(sign.link_code, true))[0] ?? null;
  const here = new URL(request.url).origin;
  try {
    const ticket = await createTicket([sign.link_code], current?.id ?? null, here, Boolean(current), cleanCodeStyle(rawStyle));
    return json({ embed: { url: ticket.url, origin: embedOrigin(here), links: [sign.link_code] }, url: null });
  } catch (err) {
    console.error('QR ticket failed:', (err as Error).message);
    return json({ url: null });
  }
}

export const GET: APIRoute = async ({ request, url }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  try {
    const svgFor = url.searchParams.get('svg');
    if (svgFor) {
      const sign = await getSign(svgFor);
      const code = sign ? (await codesFor(sign.link_code))[0] : null;
      if (!code) return json({ error: 'That sign has no branded code yet.' }, 404);
      return new Response(await codeSvg(code.svg_url), { headers: SVG_HEADERS });
    }
    return json(await state(url.searchParams.get('fresh') === '1'));
  } catch (err) {
    return failure(err);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body?.action;

  try {
    if (action === 'preview') {
      const link = await buildCheckinLink(siteOrigin(request), eventIdsFrom(body), body.createRegistration === true);
      return json({ url: link.url, titles: link.events.map((e) => e.title) });
    }

    if (action === 'save') return await save(request, body);

    if (action === 'delete') {
      const sign = typeof body.id === 'string' ? await getSign(body.id) : null;
      if (!sign) return json({ state: await state() });
      // Printed copies of it now land on the general check-in page. Pointed while the sign
      // still holds the link (so no new sign can have taken it yet), and only if it still
      // opens this sign's classes; then the link is free for the next sign.
      if (sign.pointed_url) await pointLink(sign.link_code, `${siteOrigin(request)}/check-in`, sign.pointed_url).catch(() => {});
      await deleteSign(sign.id);
      return json({ state: await state() });
    }

    if (action === 'codes') return typeof body.signId === 'string' ? await newCodeFor(request, body.signId, body.style) : await codesUrl(request, body.remake === true);

    if (action === 'venmo-find') return json({ account: withLinks({ ...(await lookupVenmo(body.username)), label: '' }) });

    if (action === 'venmo-save') {
      const account = await lookupVenmo(body.username);
      const label = typeof body.label === 'string' ? body.label.trim().slice(0, MAX_LABEL) : '';
      const saved = await updateQrStudio((s) => {
        const others = s.venmo.filter((a) => a.username.toLowerCase() !== account.username.toLowerCase());
        if (others.length >= MAX_VENMO) throw new VenmoLookupError(`Remove someone first: up to ${MAX_VENMO} accounts can be remembered.`);
        s.venmo = [...others, { ...account, label }];
      });
      return json(venmoState(saved));
    }

    if (action === 'venmo-remove' || action === 'venmo-default') {
      const username = cleanVenmoUsername(body.username);
      const saved = await updateQrStudio((s) => {
        const same = (a: { username: string }) => a.username.toLowerCase() === username?.toLowerCase();
        if (!s.venmo.some(same)) throw new VenmoLookupError("That account isn't on the list.");
        if (action === 'venmo-default') s.defaultVenmo = s.venmo.find(same)!.username;
        else {
          s.venmo = s.venmo.filter((a) => !same(a));
          if (s.defaultVenmo && same({ username: s.defaultVenmo })) s.defaultVenmo = s.venmo[0]?.username ?? null;
        }
      });
      return json(venmoState(saved));
    }
  } catch (err) {
    return failure(err);
  }
  return json({ error: 'Unknown action.' }, 400);
};
