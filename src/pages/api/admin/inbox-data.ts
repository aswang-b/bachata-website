import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const COLUMNS = 'id, created_at, first_name, last_name, email, phone, instagram, whatsapp, message, seen, replied_at, replied_by';

// Contact form messages (migrations 0049, 0054). GET → the ones not replied
// to yet; GET ?archive=replied → the replied ones (the inbox's archive, only
// loaded when opened).
export const GET: APIRoute = async ({ request, url }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);

  const archive = url.searchParams.get('archive') === 'replied';
  let query = supabase.from('contact_messages').select(COLUMNS).is('deleted_at', null);
  query = archive ? query.not('replied_at', 'is', null).order('replied_at', { ascending: false }) : query.is('replied_at', null).order('created_at', { ascending: false });
  const { data, error } = await query;
  if (error) return json({ error: 'Failed to load messages.' }, 500);

  // Opening the inbox is what marks messages as seen.
  if (!archive) {
    const unseenIds = (data ?? []).filter((m) => !m.seen).map((m) => m.id);
    if (unseenIds.length > 0) await supabase.from('contact_messages').update({ seen: true }).in('id', unseenIds);
  }

  return json({ messages: data ?? [] });
};

// POST { id, replied: true | false }: marks a message replied (it moves to the
// archive) or moves it back to the inbox.
export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id || typeof body?.replied !== 'boolean') return json({ error: 'Missing id or replied.' }, 400);

  const update = body.replied ? { replied_at: new Date().toISOString(), replied_by: user.email ?? null, seen: true } : { replied_at: null, replied_by: null };
  const { data, error } = await supabase.from('contact_messages').update(update).eq('id', id).is('deleted_at', null).select('id').maybeSingle();
  if (error) return json({ error: 'Failed to update the message.' }, 500);
  if (!data) return json({ error: 'Message not found.' }, 404);
  return json({ ok: true });
};
