import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin';
import { supabase } from '../../../lib/supabase';
import { deleteDeal, listDeals, saveDeal, validateDeal } from '../../../lib/dealsStore';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// A class or event a deal can cover: one per series.
interface DealOption {
  key: string;
  title: string;
  type: 'class' | 'event';
  count: number;
  first: string;
  last: string;
  price: number | null;
  upcoming: boolean;
}

// The upcoming public classes and events (only those take public sign-ups),
// plus any past ones a deal still names, so its list reads properly.
async function loadOptions(dealKeys: string[]): Promise<DealOption[]> {
  const columns = 'id, title, event_type, start_time, google_recurring_event_id, price_whole_series, price_drop_in';
  const now = new Date().toISOString();
  const ids = dealKeys.filter((k) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k));
  const [upcoming, byRecurring, byId] = await Promise.all([
    supabase.from('events').select(columns).eq('visibility', 'public').gte('start_time', now).order('start_time'),
    dealKeys.length > 0 ? supabase.from('events').select(columns).in('google_recurring_event_id', dealKeys) : null,
    ids.length > 0 ? supabase.from('events').select(columns).in('id', ids) : null,
  ]);
  const error = upcoming.error ?? byRecurring?.error ?? byId?.error;
  if (error) throw new Error(`Failed to load classes: ${error.message}`);

  const byKey = new Map<string, DealOption>();
  // The same event can come back from more than one of the queries.
  const seen = new Set<string>();
  for (const e of [...(upcoming.data ?? []), ...(byRecurring?.data ?? []), ...(byId?.data ?? [])]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const key = e.google_recurring_event_id ?? e.id;
    const existing = byKey.get(key);
    const isUpcoming = e.start_time >= now;
    if (!existing) {
      byKey.set(key, {
        key,
        title: e.title,
        type: e.event_type === 'event' ? 'event' : 'class',
        count: 1,
        first: e.start_time,
        last: e.start_time,
        price: e.price_whole_series ?? e.price_drop_in ?? null,
        upcoming: isUpcoming,
      });
      continue;
    }
    existing.count += 1;
    if (e.start_time < existing.first) existing.first = e.start_time;
    if (e.start_time > existing.last) existing.last = e.start_time;
    existing.upcoming ||= isUpcoming;
  }
  return [...byKey.values()].sort((a, b) => a.first.localeCompare(b.first));
}

// Admin → Deals: list (with the classes a deal can cover), save, delete.
export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  try {
    const deals = await listDeals();
    const options = await loadOptions([...new Set(deals.flatMap((d) => d.seriesKeys))]);
    return json({ deals, options });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to load deals.' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  const payload = await request.json().catch(() => null);
  const checked = validateDeal(payload);
  if ('error' in checked) return json({ error: checked.error }, 400);
  const id = typeof payload?.id === 'string' && payload.id ? payload.id : null;
  try {
    await saveDeal(id, checked.row);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to save the deal.' }, 500);
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing deal id.' }, 400);
  try {
    await deleteDeal(id);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Failed to delete the deal.' }, 500);
  }
  return json({ ok: true });
};
