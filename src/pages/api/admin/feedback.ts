import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { hideTestRows } from '../../../lib/testMode';
import { cleanTypedPeople, recipientKey, type FeedbackRecipient } from '../../../lib/feedback';
import { fillIn, isQuestion, summarizeItem, withTopMessage, type Answers, type FeedbackItem, type SummaryResponse } from '../../../lib/feedbackQuestions';
import { feedbackOptions, feedbackRecipients, type FeedbackOption, type FeedbackScope, type FeedbackTarget } from '../../../lib/feedbackRecipients';
import { createCampaign, emailInvites, whatsappInvite } from '../../../lib/feedbackStore';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const SCOPES: FeedbackScope[] = ['occurrence', 'series', 'event'];
// What {class} says on a typed-in request with no class or event named.
const GENERAL_NAME = 'Dance with B';
const MAX_CLASS_NAME = 200;

function targetFrom(read: (name: string) => unknown): FeedbackTarget | null {
  const get = (k: string) => {
    const v = read(k);
    return typeof v === 'string' && v ? v : null;
  };
  const scope = get('scope') as FeedbackScope | null;
  const seriesKey = get('seriesKey');
  if (!scope || !SCOPES.includes(scope) || !seriesKey) return null;
  return { scope, seriesKey, eventId: get('eventId') };
}

// Who shared their name, if anyone.
function contactOf(r: { contact_name: string | null; contact_email: string | null; contact_phone: string | null }): string | null {
  return [r.contact_name, r.contact_email, r.contact_phone].filter(Boolean).join(' · ') || null;
}

// GET ?view=options → what can be asked about; GET ?scope&seriesKey&eventId →
// who'd be asked; GET → every campaign with its invites and results. Which
// dancers answered, and who said what, is never sent.
export const GET: APIRoute = async ({ request, url }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);

  try {
    if (url.searchParams.get('view') === 'options') return json({ options: await feedbackOptions() });
    const target = targetFrom((k) => url.searchParams.get(k));
    if (target) {
      const found = await feedbackRecipients(target);
      if (!found) return json({ error: 'That class or event is no longer listed.' }, 404);
      return json({ ...found, keys: found.recipients.map(recipientKey) });
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }

  const { data: campaigns, error } = await hideTestRows(supabase.from('feedback_campaigns').select('*'), 'title').order('created_at', { ascending: false });
  if (error) return json({ error: 'Failed to load feedback requests.' }, 500);
  const ids = (campaigns ?? []).map((c) => c.id);
  const [invites, responses] = ids.length
    ? await Promise.all([
        supabase.from('feedback_invites').select('id, campaign_id, first_name, last_name, email, phone, emailed_at, whatsapp_at').in('campaign_id', ids).order('first_name'),
        supabase.from('feedback_responses').select('campaign_id, created_at, finished_at, via, answers, contact_name, contact_email, contact_phone').in('campaign_id', ids).order('created_at', { ascending: false }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (invites.error || responses.error) return json({ error: 'Failed to load feedback requests.' }, 500);

  return json({
    campaigns: (campaigns ?? []).map((c) => {
      const rows = (responses.data ?? []).filter((r) => r.campaign_id === c.id);
      const forSummary: SummaryResponse[] = rows.map((r) => ({ answers: r.answers as Answers, created_at: r.created_at, contact: contactOf(r) }));
      const items = (c.items as FeedbackItem[]).filter(isQuestion);
      const written = new Set(items.filter((i) => i.kind === 'text').map((i) => i.id));
      return {
        ...c,
        invites: (invites.data ?? []).filter((i) => i.campaign_id === c.id),
        stats: {
          started: rows.filter((r) => r.via === 'invite').length,
          shared: rows.filter((r) => r.via === 'shared').length,
          finished: rows.filter((r) => r.finished_at).length,
        },
        summaries: items.map((item) => summarizeItem({ ...item, text: fillIn(item.text, { className: c.class_title }) }, forSummary)),
        // Happy to be contacted, with no written answer to show it beside.
        contacts: forSummary.filter((r) => r.contact && !Object.keys(r.answers).some((k) => written.has(k))).map((r) => r.contact),
      };
    }),
  });
};

// POST { action: 'create', questionnaireId, message, scope, seriesKey, eventId, keys }
// → a new campaign for the ticked dancers (none is fine: it still has its shared
// link), emailed straight away. Scope 'general' is typed in rather than listed:
// { className, people } instead of the class and keys, both optional;
// { action: 'email', campaignId } emails anyone not emailed yet;
// { action: 'whatsapp', inviteId } → { url } a WhatsApp message to send;
// { action: 'close' | 'reopen' | 'delete', campaignId }.
export const POST: APIRoute = async ({ request, url }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) return json({ error: authError }, 403);
  const body = await request.json().catch(() => null);
  const action = body?.action;
  const campaignId = typeof body?.campaignId === 'string' ? body.campaignId : '';

  try {
    if (action === 'create') {
      const { data: questionnaire } = await supabase.from('feedback_questionnaires').select('id, name, items, contact_box').eq('id', String(body.questionnaireId)).maybeSingle();
      if (!questionnaire) return json({ error: 'Pick a questionnaire.' }, 400);
      const items = withTopMessage(questionnaire.items as FeedbackItem[], typeof body.message === 'string' ? body.message : '');

      let option: FeedbackOption;
      let recipients: FeedbackRecipient[] = [];
      if (body.scope === 'general') {
        const typed = cleanTypedPeople(body.people);
        if ('error' in typed) return json({ error: typed.error }, 400);
        const className = typeof body.className === 'string' ? body.className.trim() : '';
        if (className.length > MAX_CLASS_NAME) return json({ error: 'That class or event name is too long.' }, 400);
        recipients = typed.people;
        option = { scope: 'general', seriesKey: '', eventId: null, classTitle: className || GENERAL_NAME, title: className || questionnaire.name, startTime: '', people: recipients.length };
      } else {
        const target = targetFrom((k) => body[k]);
        if (!target) return json({ error: 'Pick a class or event.' }, 400);
        const found = await feedbackRecipients(target);
        if (!found) return json({ error: 'That class or event is no longer listed.' }, 404);
        const keys = new Set(Array.isArray(body.keys) ? body.keys.filter((k: unknown) => typeof k === 'string') : []);
        option = found.option;
        recipients = found.recipients.filter((r) => keys.has(recipientKey(r)));
      }

      const id = await createCampaign({ option, questionnaireId: questionnaire.id, items, contactBox: questionnaire.contact_box, recipients, createdBy: user.email ?? null });
      try {
        return json({ id, emailed: await emailInvites(id, url.origin) });
      } catch (err) {
        return json({ id, emailed: 0, emailError: (err as Error).message });
      }
    }
    if (action === 'email' && campaignId) return json({ emailed: await emailInvites(campaignId, url.origin) });
    if (action === 'whatsapp' && typeof body.inviteId === 'string') return json({ url: await whatsappInvite(body.inviteId, url.origin) });
    if ((action === 'close' || action === 'reopen') && campaignId) {
      await supabase.from('feedback_campaigns').update({ closed_at: action === 'close' ? new Date().toISOString() : null }).eq('id', campaignId).throwOnError();
      return json({ ok: true });
    }
    if (action === 'delete' && campaignId) {
      await supabase.from('feedback_campaigns').delete().eq('id', campaignId).throwOnError();
      return json({ ok: true });
    }
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
  return json({ error: 'Unknown action.' }, 400);
};
