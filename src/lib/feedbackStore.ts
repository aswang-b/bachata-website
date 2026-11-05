import { createHash, randomBytes } from 'node:crypto';
import { supabase } from './supabase';
import { sendEmailBatch } from './email';
import { checkAndIncrementUsage } from './apiUsage';
import { buildFeedbackEmailHtml, feedbackEmailSubject } from './feedbackEmail';
import { MAX_NAME_LENGTH, fillIn, missingRequired, topMessage, type Answers, type FeedbackItem } from './feedbackQuestions';
import { feedbackMessage, whatsappNumber, whatsappUrl, type FeedbackRecipient } from './feedback';
import type { FeedbackOption } from './feedbackRecipients';

// Feedback requests (migrations 0064-0066): campaigns and their invites, the
// one-time links sent to each dancer, the link anyone can use, and the answers.
// A one-time link's secret is only ever in the message sent; the database keeps
// its hash. An answer is found again by a second hash of that secret, which
// names no invite, so it can't be traced to who gave it unless they share
// their name. On a shared link that secret is a cookie in their browser.

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const linkHash = (token: string) => sha256(`feedback-link:${token}`);
const responseKey = (token: string) => sha256(`feedback-response:${token}`);
const sharedResponseKey = (secret: string) => sha256(`feedback-shared-response:${secret}`);
const feedbackLink = (origin: string, token: string) => `${origin}/feedback/${token}`;
export const newSharedSecret = () => randomBytes(24).toString('base64url');
export const SHARED_PREFIX = 's-';
// New answers one network can start through shared links in a day.
const SHARED_DAILY_CAP_PER_IP = 60;

// A new link for an invite, by email or WhatsApp.
async function newLink(inviteId: string, channel: 'email' | 'whatsapp'): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  const { error } = await supabase.from('feedback_links').insert({ token_hash: linkHash(token), invite_id: inviteId, channel });
  if (error) throw new Error(`Couldn't make a feedback link: ${error.message}`);
  return token;
}

export async function createCampaign(params: {
  option: FeedbackOption;
  questionnaireId: string;
  items: FeedbackItem[];
  contactBox: boolean;
  recipients: FeedbackRecipient[];
  createdBy: string | null;
}): Promise<string> {
  const { option } = params;
  const { data, error } = await supabase
    .from('feedback_campaigns')
    .insert({
      title: option.title,
      class_title: option.classTitle,
      scope: option.scope,
      series_key: option.seriesKey || null,
      event_id: option.scope === 'occurrence' || option.scope === 'event' ? option.eventId : null,
      questionnaire_id: params.questionnaireId,
      items: params.items,
      contact_box: params.contactBox,
      created_by: params.createdBy,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Couldn't save the feedback request: ${error?.message}`);
  if (params.recipients.length > 0) {
    const invites = params.recipients.map((r) => ({ campaign_id: data.id, first_name: r.firstName, last_name: r.lastName, email: r.email, phone: r.phone }));
    const { error: inviteError } = await supabase.from('feedback_invites').insert(invites);
    if (inviteError) {
      await supabase.from('feedback_campaigns').delete().eq('id', data.id);
      throw new Error(`Couldn't save who to ask: ${inviteError.message}`);
    }
  }
  return data.id as string;
}

// Emails everyone in the campaign with an email who hasn't been emailed yet
// (so it also retries a send that failed). Resolves to how many were sent.
export async function emailInvites(campaignId: string, origin: string): Promise<number> {
  const { data: campaign } = await supabase.from('feedback_campaigns').select('class_title, items, closed_at').eq('id', campaignId).maybeSingle();
  if (!campaign) throw new Error('That feedback request no longer exists.');
  if (campaign.closed_at) throw new Error('This feedback request is closed.');
  const { data: invites, error } = await supabase
    .from('feedback_invites')
    .select('id, first_name, email')
    .eq('campaign_id', campaignId)
    .not('email', 'is', null)
    .is('emailed_at', null);
  if (error) throw new Error(`Couldn't load who to email: ${error.message}`);
  if (!invites || invites.length === 0) return 0;

  const items = campaign.items as FeedbackItem[];
  const className = campaign.class_title as string;
  const emails = await Promise.all(
    invites.map(async (i) => ({
      to: i.email as string,
      subject: feedbackEmailSubject({ className, items }),
      html: buildFeedbackEmailHtml({ firstName: i.first_name, className, items, link: feedbackLink(origin, await newLink(i.id, 'email')) }),
    }))
  );
  await sendEmailBatch(emails);
  await supabase
    .from('feedback_invites')
    .update({ emailed_at: new Date().toISOString() })
    .in('id', invites.map((i) => i.id));
  return invites.length;
}

// A wa.me link that opens WhatsApp with the request (and a new link of its own) typed out.
export async function whatsappInvite(inviteId: string, origin: string): Promise<string> {
  const { data: invite } = await supabase
    .from('feedback_invites')
    .select('id, first_name, phone, feedback_campaigns!inner(class_title, items, closed_at)')
    .eq('id', inviteId)
    .maybeSingle();
  if (!invite) throw new Error('That dancer is no longer on this feedback request.');
  const campaign = invite.feedback_campaigns as unknown as { class_title: string; items: FeedbackItem[]; closed_at: string | null };
  if (campaign.closed_at) throw new Error('This feedback request is closed.');
  const number = whatsappNumber(invite.phone);
  if (!number) throw new Error(`${invite.first_name}'s phone number can't be used for WhatsApp.`);
  const link = feedbackLink(origin, await newLink(invite.id, 'whatsapp'));
  await supabase.from('feedback_invites').update({ whatsapp_at: new Date().toISOString() }).eq('id', invite.id);
  const top = topMessage(campaign.items);
  const lead = top ? fillIn(top, { className: campaign.class_title, name: invite.first_name }) : null;
  return whatsappUrl(number, feedbackMessage(lead, invite.first_name, campaign.class_title, link));
}

interface InviteRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  responded: boolean;
}

interface CampaignRow {
  id: string;
  class_title: string;
  items: FeedbackItem[];
  contact_box: boolean;
  closed_at: string | null;
}

export interface FeedbackPage {
  mode: 'invite' | 'shared';
  campaignId: string;
  className: string;
  items: FeedbackItem[];
  contactBox: boolean;
  closed: boolean;
  firstName: string | null;
  // This link's (or, shared, this browser's) answers so far.
  hasResponse: boolean;
  answers: Answers;
  finished: boolean;
  contact: { name: string; way: string };
  // Answered through another of this dancer's links (the email and a WhatsApp message).
  answeredElsewhere: boolean;
  invite: InviteRow | null;
  responseKey: string | null;
}

const CAMPAIGN_COLUMNS = 'id, class_title, items, contact_box, closed_at';

// What the feedback page shows for a link; null when the link isn't one.
// `sharedSecret` reads the browser's cookie, for a shared link.
export async function loadFeedbackPage(token: string, sharedSecret: (campaignId: string) => string | undefined): Promise<FeedbackPage | null> {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  let campaign: CampaignRow;
  let invite: InviteRow | null = null;
  let key: string | null;
  if (token.startsWith(SHARED_PREFIX)) {
    const { data } = await supabase.from('feedback_campaigns').select(CAMPAIGN_COLUMNS).eq('share_token', token.slice(SHARED_PREFIX.length)).maybeSingle();
    if (!data) return null;
    campaign = data as CampaignRow;
    const secret = sharedSecret(campaign.id);
    key = secret ? sharedResponseKey(secret) : null;
  } else {
    const { data: link } = await supabase
      .from('feedback_links')
      .select(`feedback_invites!inner(id, first_name, last_name, email, phone, responded, feedback_campaigns!inner(${CAMPAIGN_COLUMNS}))`)
      .eq('token_hash', linkHash(token))
      .maybeSingle();
    if (!link) return null;
    const { feedback_campaigns: c, ...row } = link.feedback_invites as unknown as InviteRow & { feedback_campaigns: CampaignRow };
    campaign = c;
    invite = row;
    key = responseKey(token);
  }
  const { data: response } = key
    ? await supabase.from('feedback_responses').select('answers, finished_at, contact_name, contact_email, contact_phone').eq('response_key', key).maybeSingle()
    : { data: null };
  return {
    mode: invite ? 'invite' : 'shared',
    campaignId: campaign.id,
    className: campaign.class_title,
    items: campaign.items,
    contactBox: campaign.contact_box,
    closed: Boolean(campaign.closed_at),
    firstName: invite?.first_name ?? null,
    hasResponse: Boolean(response),
    answers: (response?.answers as Answers) ?? {},
    finished: Boolean(response?.finished_at),
    contact: { name: response?.contact_name ?? '', way: response?.contact_email ?? response?.contact_phone ?? '' },
    answeredElsewhere: !response && Boolean(invite?.responded),
    invite,
    responseKey: key,
  };
}

// Gives a shared link's page the secret just made for this browser.
export function useSharedSecret(page: FeedbackPage, secret: string): void {
  page.responseKey = sharedResponseKey(secret);
}

export type SaveResult = 'saved' | 'closed' | 'answered' | 'empty' | 'missing' | 'limited';

// Who to contact, on the dancer's say-so only: their invite's name and details
// when they tick the box, or what they typed on a shared link.
function contactColumns(page: FeedbackPage, contact: { share: boolean; name: string; way: string }) {
  const none = { contact_name: null, contact_email: null, contact_phone: null };
  if (!page.contactBox) return none;
  if (page.invite) {
    if (!contact.share) return none;
    return { contact_name: `${page.invite.first_name} ${page.invite.last_name}`.trim(), contact_email: page.invite.email, contact_phone: page.invite.phone };
  }
  const name = contact.name.trim().slice(0, MAX_NAME_LENGTH);
  const way = contact.way.trim().slice(0, MAX_NAME_LENGTH);
  if (!name && !way) return none;
  return { contact_name: name || 'No name given', contact_email: way.includes('@') ? way : null, contact_phone: way && !way.includes('@') ? way : null };
}

// Saves everything on the form, replacing what this link saved before. The
// first answer through any of a dancer's links claims their invite, so each
// dancer is counted once. Submit (`finish`) also needs the required questions;
// what was given is saved either way.
export async function saveAnswers(
  page: FeedbackPage,
  answers: Answers,
  contact: { share: boolean; name: string; way: string },
  options: { finish: boolean; ip: string }
): Promise<SaveResult> {
  if (page.closed) return 'closed';
  if (!page.responseKey) throw new Error('A shared link needs its secret before saving.');
  const given = Object.keys(answers).length > 0;
  if (!page.hasResponse && !given) return options.finish ? 'empty' : 'saved';

  let claimedInvite = false;
  if (!page.hasResponse) {
    if (page.invite) {
      const { data: claimed } = await supabase.from('feedback_invites').update({ responded: true }).eq('id', page.invite.id).eq('responded', false).select('id');
      claimedInvite = Boolean(claimed && claimed.length > 0);
      if (!claimedInvite) {
        // Lost to a save from this same link a moment ago? Then carry on; otherwise it's another link's.
        const { data: mine } = await supabase.from('feedback_responses').select('id').eq('response_key', page.responseKey).maybeSingle();
        if (!mine) return 'answered';
      }
    } else if (!(await checkAndIncrementUsage(`feedback-shared:${options.ip}`, SHARED_DAILY_CAP_PER_IP))) {
      return 'limited';
    }
  }

  const missing = options.finish && missingRequired(page.items, answers).length > 0;
  const finishedAt = options.finish && !missing ? { finished_at: new Date().toISOString() } : {};
  const { error } = await supabase.from('feedback_responses').upsert(
    {
      campaign_id: page.campaignId,
      response_key: page.responseKey,
      via: page.mode,
      answers,
      ...contactColumns(page, contact),
      ...finishedAt,
    },
    { onConflict: 'response_key' }
  );
  if (error) {
    if (claimedInvite) await supabase.from('feedback_invites').update({ responded: false }).eq('id', page.invite!.id);
    throw new Error(`Couldn't save the answers: ${error.message}`);
  }
  return missing ? 'missing' : 'saved';
}
