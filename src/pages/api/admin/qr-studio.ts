import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { CheckinLinkError, buildCheckinLink, eventIdsFrom } from '../../../lib/checkinLink';
import { BrandedQrError, brandedQrConfigured, codeSvg, codesFor, createLink, generatorUrl, pointLink, readLink } from '../../../lib/brandedQr';
import { QrStudioStoreError, loadQrStudio, updateQrStudio, type QrStudio } from '../../../lib/qrStudioStore';
import { VenmoLookupError, cleanVenmoUsername, lookupVenmo, venmoCodeUrl, venmoProfileUrl } from '../../../lib/venmo';
import { fakeQrServices } from '../../../lib/testMode';

export const prerender = false;

// The door sign on /admin/qr: a branded check-in code (a short link on
// qr.dancewithb.fun, repointed to the classes picked) and a Venmo code.
//
// GET → the sign's state (?fresh=1 asks the QR site again instead of using
// the minute-long cache); GET ?svg=<id> → a saved branded code's SVG.
// POST { action: 'create-link' } makes the check-in short link (once);
// 'choose-code' { id }; 'point' { eventIds, createRegistration, confirm?, direct? }
// repoints it (409 { pointedLabel } when it was pointed elsewhere in the last
// few hours, unless confirm), or with `direct` (no working short link) only
// returns the plain check-in address; 'venmo-find' { username } looks someone
// up; 'venmo-save' { username, label }, 'venmo-remove' { username },
// 'venmo-default' { username } (these three answer with only the Venmo part).

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const CHECKIN_LABEL = 'Class check-in (dancewithb.fun door sign)';
// Repointing within this long of the last time, to somewhere else, asks first.
const RECENT_MS = 6 * 60 * 60 * 1000;
const MAX_VENMO = 30;
const MAX_LABEL = 60;
// It comes from another site: never run anything in it, even if opened directly.
const SVG_HEADERS = {
  'Content-Type': 'image/svg+xml',
  'Cache-Control': 'private, no-cache',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
  'X-Content-Type-Options': 'nosniff',
};

// Check-in links go to the live site (phones can't open a dev server), except in the test suite.
const siteOrigin = (request: Request) => (fakeQrServices() ? new URL(request.url).origin : (import.meta.env.SITE ?? 'https://dancewithb.fun').replace(/\/$/, ''));

const withLinks = (a: QrStudio['venmo'][number]) => ({ ...a, codeUrl: venmoCodeUrl(a.userId), profileUrl: venmoProfileUrl(a.username) });

const venmoState = (studio: QrStudio) => ({ venmo: studio.venmo.map(withLinks), defaultVenmo: studio.defaultVenmo });

async function state(fresh = false): Promise<Record<string, unknown>> {
  const { studio, saved } = await loadQrStudio();
  const base = { saved, connected: brandedQrConfigured(), ...venmoState(studio), checkin: null as unknown };
  if (!studio.checkin || !base.connected) return base;
  try {
    const [link, codes] = await Promise.all([readLink(studio.checkin.code), codesFor(studio.checkin.code, fresh)]);
    const chosen = codes.find((c) => c.id === studio.checkin!.designId) ?? codes[0] ?? null;
    base.checkin = {
      ...studio.checkin,
      missing: !link,
      hits: link?.hits ?? 0,
      opens: link?.url ?? null,
      codes: codes.map((c) => ({ id: c.id, name: c.name, created_at: c.created_at })),
      designId: chosen?.id ?? null,
      generatorUrl: generatorUrl(studio.checkin.short),
    };
  } catch (err) {
    base.checkin = { ...studio.checkin, error: (err as Error).message, codes: [], generatorUrl: generatorUrl(studio.checkin.short) };
  }
  return base;
}

function failure(err: unknown): Response {
  if (err instanceof CheckinLinkError || err instanceof BrandedQrError) return json({ error: err.message }, err.status);
  if (err instanceof VenmoLookupError) return json({ error: err.message }, 400);
  if (err instanceof QrStudioStoreError) return json({ error: err.message }, 500);
  console.error('QR studio failed:', err);
  return json({ error: 'Something went wrong.' }, 500);
}

export const GET: APIRoute = async ({ request, url }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  try {
    const fresh = url.searchParams.get('fresh') === '1';
    const svgId = Number(url.searchParams.get('svg'));
    if (svgId) {
      // Only a code saved for this sign's own link (the list is cached for a minute).
      const { studio } = await loadQrStudio();
      const codes = studio.checkin ? await codesFor(studio.checkin.code, fresh) : [];
      if (!codes.some((c) => c.id === svgId)) return json({ error: "That code isn't one of the door sign's." }, 404);
      return new Response(await codeSvg(svgId, fresh), { headers: SVG_HEADERS });
    }
    return json(await state(fresh));
  } catch (err) {
    return failure(err);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  const body = await request.json().catch(() => ({}));
  const action = body?.action;

  try {
    if (action === 'create-link') {
      const { studio, saved } = await loadQrStudio();
      if (!saved) return json({ error: 'Run migration 0068 in Supabase first, so the site can remember its link.' }, 409);
      if (studio.checkin && (await readLink(studio.checkin.code))) return json({ error: 'The check-in link already exists.' }, 409);
      const link = await createLink(`${siteOrigin(request)}/check-in`, CHECKIN_LABEL);
      await updateQrStudio((s) => {
        s.checkin = { code: link.code, short: link.short, designId: null, pointedUrl: link.url, pointedLabel: 'The check-in page', pointedAt: null, pointedEventIds: [], pointedTitles: [] };
      });
      return json(await state(true));
    }

    if (action === 'choose-code') {
      await updateQrStudio((s) => {
        if (s.checkin) s.checkin.designId = Number(body.id) || null;
      });
      return json(await state());
    }

    if (action === 'point') {
      const link = await buildCheckinLink(siteOrigin(request), eventIdsFrom(body), body?.createRegistration === true);
      const label = `${link.title} · ${link.scheduleLabel}`;
      const { studio } = await loadQrStudio();
      const current = studio.checkin;
      // No short link, or the page found it deleted or the QR site down: a plain code still works.
      if (body?.direct === true || !current || !brandedQrConfigured()) return json({ pointed: false, url: link.url, title: link.title, scheduleLabel: link.scheduleLabel });

      const same = current.pointedUrl === link.url;
      const recent = current.pointedAt && Date.now() - Date.parse(current.pointedAt) < RECENT_MS;
      if (recent && !same && body?.confirm !== true) {
        return json({ error: 'confirm', pointedLabel: current.pointedLabel, pointedAt: current.pointedAt }, 409);
      }
      // Sent even when unchanged, in case it was repointed on the QR site itself.
      await pointLink(current.code, link.url);
      const pointedEventIds = link.events.map((e) => e.id);
      const pointedTitles = link.events.map((e) => e.title);
      await updateQrStudio((s) => {
        if (!s.checkin) return;
        // The same classes again don't restart the "pointed recently" window.
        const pointedAt = same && s.checkin.pointedAt ? s.checkin.pointedAt : new Date().toISOString();
        Object.assign(s.checkin, { pointedUrl: link.url, pointedLabel: label, pointedAt, pointedEventIds, pointedTitles });
      });
      return json({ pointed: true, url: link.url, short: current.short, title: link.title, scheduleLabel: link.scheduleLabel });
    }

    if (action === 'venmo-find') return json({ account: withLinks({ ...(await lookupVenmo(body.username)), label: '' }) });

    if (action === 'venmo-save') {
      const account = await lookupVenmo(body.username);
      const label = typeof body.label === 'string' ? body.label.trim().slice(0, MAX_LABEL) : '';
      const saved = await updateQrStudio((s) => {
        const others = s.venmo.filter((a) => a.username.toLowerCase() !== account.username.toLowerCase());
        if (others.length >= MAX_VENMO) throw new VenmoLookupError(`Remove someone first: the sign remembers up to ${MAX_VENMO} accounts.`);
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
