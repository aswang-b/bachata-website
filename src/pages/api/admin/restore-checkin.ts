import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { CHECKINS_LOCK_RESOURCE, requireLock } from '../../../lib/editLock';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { auditId, holderId } = body ?? {};
  if (!auditId) {
    return new Response(JSON.stringify({ error: 'Missing auditId.' }), { status: 400 });
  }

  const holder = `${user.email}::${holderId}`;
  try {
    await requireLock(CHECKINS_LOCK_RESOURCE, holder);
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Lock required.' }), { status: 409 });
  }

  const { data: auditRow, error: auditError } = await supabase
    .from('deletion_audit')
    .select('*')
    .eq('id', auditId)
    .eq('table_name', 'class_checkins')
    .maybeSingle();

  if (auditError || !auditRow) {
    return new Response(JSON.stringify({ error: 'Deletion record not found (it may be older than 7 days).' }), { status: 404 });
  }

  const checkinId = auditRow.record_id as string;
  const { data: existing } = await supabase.from('class_checkins').select('id').eq('id', checkinId).maybeSingle();
  if (existing) {
    return new Response(JSON.stringify({ error: 'A check-in with this ID already exists — nothing to restore.' }), { status: 409 });
  }

  const { error } = await supabase.from('class_checkins').insert(auditRow.snapshot);
  if (error) return new Response(JSON.stringify({ error: 'Failed to restore check-in.' }), { status: 500 });

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
