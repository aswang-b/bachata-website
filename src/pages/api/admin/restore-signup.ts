import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { ANALYTICS_LOCK_RESOURCE, requireLock } from '../../../lib/editLock';

export const prerender = false;

interface Dancer {
  firstName?: string;
  lastName?: string;
  role?: string;
  phone?: string;
  email?: string;
}

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
    await requireLock(ANALYTICS_LOCK_RESOURCE, holder);
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Lock required.' }), { status: 409 });
  }

  const { data: auditRow, error: auditError } = await supabase.from('deletion_audit').select('*').eq('id', auditId).maybeSingle();

  if (auditError || !auditRow) {
    return new Response(JSON.stringify({ error: 'Deletion record not found (it may be older than 7 days).' }), { status: 404 });
  }

  const snapshot = auditRow.snapshot as Record<string, unknown>;
  const submissionId = auditRow.record_id as string;

  const { data: existing } = await supabase.from('intake_submissions').select('id, dancers').eq('id', submissionId).maybeSingle();

  if (auditRow.action === 'delete_submission') {
    if (existing) {
      return new Response(JSON.stringify({ error: 'A sign-up with this ID already exists — nothing to restore.' }), { status: 409 });
    }
    const { error } = await supabase.from('intake_submissions').insert(snapshot);
    if (error) return new Response(JSON.stringify({ error: 'Failed to restore sign-up.' }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (auditRow.action === 'remove_dancer') {
    const snapshotDancers = Array.isArray(snapshot.dancers) ? (snapshot.dancers as Dancer[]) : [];
    const removedDancer = auditRow.dancer_index != null ? snapshotDancers[auditRow.dancer_index] : null;
    if (!removedDancer) {
      return new Response(JSON.stringify({ error: 'Could not identify the removed dancer to restore.' }), { status: 500 });
    }

    if (!existing) {
      // The whole submission was deleted after this dancer was removed —
      // recreate it from this snapshot as the best available recovery.
      const { error } = await supabase.from('intake_submissions').insert(snapshot);
      if (error) return new Response(JSON.stringify({ error: 'Failed to restore sign-up.' }), { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    const currentDancers = Array.isArray(existing.dancers) ? (existing.dancers as Dancer[]) : [];
    const alreadyPresent = currentDancers.some(
      (d) => d.firstName === removedDancer.firstName && d.lastName === removedDancer.lastName && d.role === removedDancer.role
    );
    if (alreadyPresent) {
      return new Response(JSON.stringify({ error: 'This dancer is already on the sign-up.' }), { status: 409 });
    }

    const insertAt = Math.min(auditRow.dancer_index ?? currentDancers.length, currentDancers.length);
    const nextDancers = [...currentDancers.slice(0, insertAt), removedDancer, ...currentDancers.slice(insertAt)];

    const { error } = await supabase
      .from('intake_submissions')
      .update({
        dancers: nextDancers,
        first_name: nextDancers[0]?.firstName ?? '',
        last_name: nextDancers[0]?.lastName ?? '',
        email: nextDancers[0]?.email || null,
        phone: nextDancers[0]?.phone || null,
      })
      .eq('id', submissionId);
    if (error) return new Response(JSON.stringify({ error: 'Failed to restore dancer.' }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Unknown audit action.' }), { status: 400 });
};
