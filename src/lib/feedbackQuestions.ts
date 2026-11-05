import { RATINGS } from './feedback';

// Questionnaires (migration 0066), the rules shared by the server, the emails
// and the builder's script: the kinds of item, checking what an admin saved and
// what a dancer answered, filling in {class} and {name}, what can be tapped in
// an email, and per-question results. Pure, so it's safe in the browser bundle.

export const ITEM_KINDS = {
  faces: 'Faces (1–5)',
  scale: 'Scale (0–10)',
  yesno: 'Yes / No',
  single: 'Pick one',
  multi: 'Pick several',
  text: 'Written answer',
  message: 'Message (no answer)',
} as const;

export type ItemKind = keyof typeof ITEM_KINDS;
export interface ItemOption {
  id: string;
  label: string;
}
export interface FeedbackItem {
  id: string;
  kind: ItemKind;
  text: string;
  required?: boolean;
  options?: ItemOption[];
}
export type Answer = number | string | string[];
export type Answers = Record<string, Answer>;

export const MAX_NAME_LENGTH = 100;
export const MAX_ITEMS = 30;
export const MAX_OPTIONS = 12;
export const MAX_QUESTION_LENGTH = 300;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_OPTION_LENGTH = 120;
export const MAX_ANSWER_LENGTH = 2000;
// Pick one fits in an email as a stack of buttons up to this many choices.
const MAX_EMAIL_CHOICES = 5;

const hasOptions = (kind: ItemKind) => kind === 'single' || kind === 'multi';
export const isQuestion = (item: FeedbackItem) => item.kind !== 'message';

// What the builder sent, cleaned; a string says what to fix.
export function cleanItems(raw: unknown): FeedbackItem[] | string {
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) return `A questionnaire can have up to ${MAX_ITEMS} questions and messages.`;
  const items: FeedbackItem[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const kind = r?.kind as ItemKind;
    if (!Object.hasOwn(ITEM_KINDS, kind)) return 'One of the questions has an unknown type.';
    const text = typeof r.text === 'string' ? r.text.trim() : '';
    if (!text) return kind === 'message' ? 'A message is empty. Write something or delete it.' : 'A question is empty. Write it or delete it.';
    if (text.length > (kind === 'message' ? MAX_MESSAGE_LENGTH : MAX_QUESTION_LENGTH)) return `This is too long: "${text.slice(0, 40)}…"`;
    let id = typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID();
    if (seen.has(id)) id = crypto.randomUUID();
    seen.add(id);
    const item: FeedbackItem = { id, kind, text };
    if (kind !== 'message' && r.required === true) item.required = true;
    if (hasOptions(kind)) {
      const options = (Array.isArray(r.options) ? r.options : [])
        .map((o: { id?: unknown; label?: unknown }) => ({ id: typeof o?.id === 'string' && o.id ? o.id : crypto.randomUUID(), label: typeof o?.label === 'string' ? o.label.trim() : '' }))
        .filter((o: ItemOption) => o.label);
      if (options.length < 2 || options.length > MAX_OPTIONS) return `"${text.slice(0, 40)}" needs between 2 and ${MAX_OPTIONS} choices.`;
      if (options.some((o: ItemOption) => o.label.length > MAX_OPTION_LENGTH)) return `A choice in "${text.slice(0, 40)}" is too long.`;
      if (new Set(options.map((o: ItemOption) => o.id)).size !== options.length) return `"${text.slice(0, 40)}" has a repeated choice.`;
      item.options = options;
    }
    items.push(item);
  }
  if (!items.some(isQuestion)) return 'Add at least one question.';
  return items;
}

export function cleanAnswer(item: FeedbackItem, value: unknown): Answer | undefined {
  const inRange = (min: number, max: number) => {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
  };
  const optionIds = (item.options ?? []).map((o) => o.id);
  switch (item.kind) {
    case 'faces':
      return inRange(1, 5);
    case 'scale':
      return inRange(0, 10);
    case 'yesno':
      return value === 'yes' || value === 'no' ? value : undefined;
    case 'single':
      return typeof value === 'string' && optionIds.includes(value) ? value : undefined;
    case 'multi': {
      const picked = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string' && optionIds.includes(v));
      return picked.length ? [...new Set(picked)] : undefined;
    }
    case 'text':
      return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_ANSWER_LENGTH) : undefined;
    default:
      return undefined;
  }
}

export function cleanAnswers(items: FeedbackItem[], read: (itemId: string) => unknown): Answers {
  const answers: Answers = {};
  for (const item of items.filter(isQuestion)) {
    const value = cleanAnswer(item, read(item.id));
    if (value !== undefined) answers[item.id] = value;
  }
  return answers;
}

export const missingRequired = (items: FeedbackItem[], answers: Answers) => items.filter((i) => i.required && answers[i.id] === undefined);

// {class} is the class or event, {name} the dancer's first name; on a shared
// link there's no name, so "Hi {name}!" reads "Hi there!".
export function fillIn(text: string, values: { className: string; name?: string | null }): string {
  return text.replace(/\{class\}/gi, () => values.className).replace(/\{name\}/gi, () => values.name || 'there');
}

// The messages before the first question: the top of the email, WhatsApp
// message and page.
export function topMessage(items: FeedbackItem[]): string {
  const first = items.findIndex(isQuestion);
  return items
    .slice(0, first < 0 ? items.length : first)
    .map((i) => i.text)
    .join('\n\n');
}

// A request's own message replaces the questionnaire's top one (blank: none).
export function withTopMessage(items: FeedbackItem[], message: string): FeedbackItem[] {
  const first = items.findIndex(isQuestion);
  const rest = first < 0 ? [] : items.slice(first);
  const text = message.trim().slice(0, MAX_MESSAGE_LENGTH);
  return text ? [{ id: crypto.randomUUID(), kind: 'message', text }, ...rest] : rest;
}

export interface TapChoice {
  value: string;
  label: string;
  emoji?: string;
}

// The first question's buttons when it can be answered with one tap from the
// email; null when the email should just link to the page.
export function emailChoices(items: FeedbackItem[]): { item: FeedbackItem; choices: TapChoice[] } | null {
  const item = items.find(isQuestion);
  if (!item) return null;
  if (item.kind === 'faces') return { item, choices: RATINGS.map((r) => ({ value: String(r.value), label: r.label, emoji: r.emoji })) };
  if (item.kind === 'yesno')
    return { item, choices: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] };
  if (item.kind === 'single' && (item.options?.length ?? 0) <= MAX_EMAIL_CHOICES) return { item, choices: item.options!.map((o) => ({ value: o.id, label: o.label })) };
  return null;
}

export interface ItemSummary {
  id: string;
  kind: ItemKind;
  text: string;
  count: number;
  average: number | null;
  // One bar each, in display order (empty for written answers).
  bars: { label: string; emoji?: string; count: number }[];
  // Written answers, newest first as given.
  written: { text: string; at: string; contact: string | null }[];
}

export interface SummaryResponse {
  answers: Answers;
  created_at: string;
  contact: string | null;
}

export function summarizeItem(item: FeedbackItem, responses: SummaryResponse[]): ItemSummary {
  const given = responses.filter((r) => r.answers[item.id] !== undefined);
  const values = given.map((r) => r.answers[item.id]);
  const count = (match: (v: Answer) => boolean) => values.filter(match).length;
  const numeric = item.kind === 'faces' || item.kind === 'scale';
  let bars: ItemSummary['bars'] = [];
  if (item.kind === 'faces') bars = [...RATINGS].reverse().map((r) => ({ label: r.label, emoji: r.emoji, count: count((v) => v === r.value) }));
  if (item.kind === 'scale') bars = Array.from({ length: 11 }, (_, i) => 10 - i).map((n) => ({ label: String(n), count: count((v) => v === n) }));
  if (item.kind === 'yesno') bars = [{ label: 'Yes', count: count((v) => v === 'yes') }, { label: 'No', count: count((v) => v === 'no') }];
  if (item.kind === 'single') bars = (item.options ?? []).map((o) => ({ label: o.label, count: count((v) => v === o.id) }));
  if (item.kind === 'multi') bars = (item.options ?? []).map((o) => ({ label: o.label, count: count((v) => Array.isArray(v) && v.includes(o.id)) }));
  return {
    id: item.id,
    kind: item.kind,
    text: item.text,
    count: given.length,
    average: numeric && given.length ? (values as number[]).reduce((a, b) => a + b, 0) / given.length : null,
    bars,
    written: item.kind === 'text' ? given.map((r) => ({ text: String(r.answers[item.id]), at: r.created_at, contact: r.contact })) : [],
  };
}
