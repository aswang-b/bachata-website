import { escapeHtml } from './registrationEmail';
import { emailChoices, fillIn, isQuestion, topMessage, type FeedbackItem } from './feedbackQuestions';

// The feedback request email: the top message (or a default greeting), then
// the first question, as buttons when it can be answered in one tap. Each
// button links to the dancer's own page with that answer picked; the page saves
// it, so a mail scanner opening the links never counts as an answer.

export interface FeedbackEmailParams {
  firstName: string;
  className: string;
  items: FeedbackItem[];
  link: string;
}

export function feedbackEmailSubject(params: Pick<FeedbackEmailParams, 'className' | 'items'>): string {
  const tap = emailChoices(params.items);
  return tap ? fillIn(tap.item.text, { className: params.className }) : `A quick question about ${params.className}`;
}

const buttonStyle = 'display:block;border:1px solid #e5d9da;border-radius:14px;text-decoration:none;color:#333;';

export function buildFeedbackEmailHtml(params: FeedbackEmailParams): string {
  const values = { className: params.className, name: params.firstName };
  const tap = emailChoices(params.items);
  const questions = params.items.filter(isQuestion);
  const first = questions[0];
  const answerLink = (value: string) => escapeHtml(`${params.link}?q=${encodeURIComponent(first.id)}&a=${encodeURIComponent(value)}`);

  const custom = topMessage(params.items);
  const lead = custom
    ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;">${escapeHtml(fillIn(custom, values)).replace(/\n/g, '<br/>')}</p>`
    : `<p style="margin:0 0 12px;font-size:15px;">Hi ${escapeHtml(params.firstName)},</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">Thanks for dancing with us at ${escapeHtml(params.className)}!${tap ? ' One tap tells us how it went:' : ''}</p>`;

  let answers: string;
  if (first.kind === 'faces' && tap) {
    const faces = tap.choices
      .map(
        (c) => `<td width="20%" style="padding:0 2px;text-align:center;">
        <a href="${answerLink(c.value)}" style="${buttonStyle}padding:10px 0 8px;">
          <span style="display:block;font-size:30px;line-height:36px;">${c.emoji}</span>
          <span style="display:block;font-size:11px;color:#666;">${escapeHtml(c.label)}</span>
        </a>
      </td>`
      )
      .join('');
    answers = `<table cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:360px;margin:0 auto;table-layout:fixed;"><tr>${faces}</tr></table>`;
  } else if (tap) {
    answers = tap.choices.map((c) => `<a href="${answerLink(c.value)}" style="${buttonStyle}margin:0 auto 8px;max-width:360px;padding:11px 12px;font-size:15px;font-weight:bold;">${escapeHtml(c.label)}</a>`).join('');
  } else {
    answers = `<a href="${escapeHtml(params.link)}" style="display:inline-block;padding:12px 28px;border-radius:999px;background:#b81640;color:#fff;font-size:15px;font-weight:bold;text-decoration:none;">Answer</a>`;
  }

  const more = questions.length - 1;
  const after = tap && more > 0 ? ` After tapping there ${more === 1 ? 'is 1 more quick question' : `are ${more} more quick questions`}.` : '';

  return `
    <div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#111;">
      ${lead}
      <div style="border:1px solid #e5d9da;border-radius:16px;padding:20px 12px;text-align:center;">
        <p style="margin:0 0 16px;font-size:18px;font-weight:bold;">${escapeHtml(fillIn(first.text, values))}</p>
        ${answers}
      </div>
      <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#666;">Your answers are anonymous.${after}</p>
    </div>
  `;
}
