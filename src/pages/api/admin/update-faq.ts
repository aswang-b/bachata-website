import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { sanitizeFaqAnswerHtml } from '../../../lib/faqs';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const { id, question, answer, includeInConfirmation } = body ?? {};

  if (!id || typeof id !== 'string') {
    return new Response(JSON.stringify({ error: 'id is required.' }), { status: 400 });
  }
  if (!question || typeof question !== 'string') {
    return new Response(JSON.stringify({ error: 'question is required.' }), { status: 400 });
  }

  const { error } = await supabase
    .from('faqs')
    .update({
      question: question.trim(),
      answer: sanitizeFaqAnswerHtml(typeof answer === 'string' ? answer : ''),
      ...(typeof includeInConfirmation === 'boolean' ? { include_in_confirmation: includeInConfirmation } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to update FAQ.' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
