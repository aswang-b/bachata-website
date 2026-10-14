import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { EVENT_REGISTRATIONS_LOCK_RESOURCE, SIGNUPS_LOCK_RESOURCE, requireLock } from '../../../lib/editLock';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { submissionId, paid, holderId } = body ?? {};

  if (!submissionId || typeof paid !== 'boolean') {
    return new Response(JSON.stringify({ error: 'Missing submissionId or paid.' }), { status: 400 });
  }

  // Event registrations are edited from their own dashboard tab, under its own lock.
  const { data: submission, error: lookupError } = await supabase
    .from('intake_submissions')
    .select('registration_type')
    .eq('id', submissionId)
    .is('deleted_at', null)
    .maybeSingle();
  if (lookupError) {
    return new Response(JSON.stringify({ error: 'Failed to update.' }), { status: 500 });
  }
  if (!submission) {
    return new Response(JSON.stringify({ error: 'Sign-up not found.' }), { status: 404 });
  }
  const lockResource = submission.registration_type === 'events' ? EVENT_REGISTRATIONS_LOCK_RESOURCE : SIGNUPS_LOCK_RESOURCE;

  try {
    await requireLock(lockResource, `${user.email}::${holderId}`);
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Lock required.' }), { status: 409 });
  }

  const { error } = await supabase.from('intake_submissions').update({ paid }).eq('id', submissionId).is('deleted_at', null);
  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to update.' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
