import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { hideTestRows } from '../../../lib/testMode';
import { MAX_NAME_LENGTH, cleanItems } from '../../../lib/feedbackQuestions';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// GET → the questionnaires, with how many requests used each.
export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);

  const [list, used] = await Promise.all([
    hideTestRows(supabase.from('feedback_questionnaires').select('id, name, items, contact_box, updated_at'), 'name').is('hidden_at', null).order('created_at'),
    supabase.from('feedback_campaigns').select('questionnaire_id'),
  ]);
  if (list.error || used.error) return json({ error: 'Failed to load questionnaires.' }, 500);
  const uses = new Map<string, number>();
  for (const c of used.data ?? []) if (c.questionnaire_id) uses.set(c.questionnaire_id, (uses.get(c.questionnaire_id) ?? 0) + 1);
  return json({ questionnaires: (list.data ?? []).map((q) => ({ ...q, uses: uses.get(q.id) ?? 0 })) });
};

// POST { action: 'save', id?, updatedAt?, name, items, contactBox } → { id, updatedAt };
// refused if someone else saved it since updatedAt.
// { action: 'duplicate', id }; { action: 'delete', id } hides one a request has used.
export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';

  if (body?.action === 'save') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) return json({ error: 'Give the questionnaire a name.' }, 400);
    const items = cleanItems(body.items);
    if (typeof items === 'string') return json({ error: items }, 400);
    const row = { name, items, contact_box: body.contactBox !== false, updated_at: new Date().toISOString() };
    if (!id) {
      const { data, error } = await supabase.from('feedback_questionnaires').insert(row).select('id, updated_at').single();
      if (error || !data) return json({ error: 'Failed to save the questionnaire.' }, 500);
      return json({ id: data.id, updatedAt: data.updated_at });
    }
    const { data, error } = await supabase.from('feedback_questionnaires').update(row).eq('id', id).eq('updated_at', String(body.updatedAt)).select('id, updated_at');
    if (error) return json({ error: 'Failed to save the questionnaire.' }, 500);
    if (!data || data.length === 0) return json({ error: 'Someone else changed this questionnaire while you were editing. Your changes are still on screen: copy what you need, then reopen it.' }, 409);
    return json({ id: data[0].id, updatedAt: data[0].updated_at });
  }

  if (body?.action === 'duplicate' && id) {
    const { data: original } = await supabase.from('feedback_questionnaires').select('name, items, contact_box').eq('id', id).maybeSingle();
    if (!original) return json({ error: 'That questionnaire no longer exists.' }, 404);
    const { error } = await supabase.from('feedback_questionnaires').insert({ ...original, name: `${original.name} (copy)`.slice(0, MAX_NAME_LENGTH) });
    if (error) return json({ error: 'Failed to duplicate the questionnaire.' }, 500);
    return json({ ok: true });
  }

  if (body?.action === 'delete' && id) {
    const { count, error: countError } = await supabase.from('feedback_campaigns').select('id', { count: 'exact', head: true }).eq('questionnaire_id', id);
    if (countError) return json({ error: 'Failed to delete the questionnaire.' }, 500);
    const { error } = count
      ? await supabase.from('feedback_questionnaires').update({ hidden_at: new Date().toISOString() }).eq('id', id)
      : await supabase.from('feedback_questionnaires').delete().eq('id', id);
    if (error) return json({ error: 'Failed to delete the questionnaire.' }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action.' }, 400);
};
