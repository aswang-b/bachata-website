import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { checkAndIncrementUsage } from '../../../lib/apiUsage';
import { env } from '../../../lib/env';

export const prerender = false;

// Hard daily cap on how many times this site will load the paid Places
// Autocomplete widget, as a backstop against runaway cost from a bug or a
// leaked client-side key — independent of whatever quota/budget alerts are
// also set in Google Cloud Console. Override via MAPS_AUTOCOMPLETE_DAILY_CAP.
const DAILY_CAP = Number(env('MAPS_AUTOCOMPLETE_DAILY_CAP')) || 300;

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const allowed = await checkAndIncrementUsage('google_places_autocomplete', DAILY_CAP);
  return new Response(JSON.stringify({ allowed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
