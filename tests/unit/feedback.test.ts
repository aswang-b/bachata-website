import { describe, expect, it } from 'vitest';
import { anonymityNote, cleanTypedPeople, dedupeRecipients, feedbackMessage, recipientKey, typedPhoneProblem, whatsappNumber, whatsappUrl } from '../../src/lib/feedback';
import { buildFeedbackEmailHtml, feedbackEmailSubject } from '../../src/lib/feedbackEmail';
import {
  cleanAnswer,
  cleanItems,
  emailChoices,
  fillIn,
  missingRequired,
  summarizeItem,
  topMessage,
  withTopMessage,
  type FeedbackItem,
} from '../../src/lib/feedbackQuestions';

const person = (firstName: string, email: string | null, phone: string | null, lastName = 'Lee') => ({ firstName, lastName, email, phone });

const faces: FeedbackItem = { id: 'f', kind: 'faces', text: 'How was {class}?' };
const typed: FeedbackItem = { id: 't', kind: 'text', text: 'Anything else?' };
const scale: FeedbackItem = { id: 's', kind: 'scale', text: 'Recommend us?' };
const yesno: FeedbackItem = { id: 'y', kind: 'yesno', text: 'Again?' };
const hello: FeedbackItem = { id: 'm', kind: 'message', text: 'Hi {name}!\nThanks for {class}.' };
const choices = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `Choice ${i}` }));
const single: FeedbackItem = { id: 'p', kind: 'single', text: 'Pick', options: choices(3) };
const multi: FeedbackItem = { id: 'k', kind: 'multi', text: 'Pick some', options: choices(3) };

describe('feedback recipients', () => {
  it('asks a dancer once however many classes they came to, filling in contacts from each', () => {
    const merged = dedupeRecipients([person('Ana', null, '608-555-0111'), person('ana ', 'Ana@Example.com', '(608) 555 0111'), person('Ana', null, null)]);
    expect(merged).toEqual([{ firstName: 'Ana', lastName: 'Lee', email: 'ana@example.com', phone: '608-555-0111' }]);
  });

  it('keeps two namesakes with different contacts apart', () => {
    expect(dedupeRecipients([person('Sam', 'a@example.com', null), person('Sam', 'b@example.com', null)])).toHaveLength(2);
  });

  it('merges a dancer given once with only an email and once with only a phone', () => {
    expect(dedupeRecipients([person('Ana', 'ana@example.com', null), person('Ana', null, '6085550111')])).toEqual([
      { firstName: 'Ana', lastName: 'Lee', email: 'ana@example.com', phone: '6085550111' },
    ]);
    // A phone that disagrees still tells two namesakes apart.
    expect(dedupeRecipients([person('Ana', 'ana@example.com', '6085550111'), person('Ana', null, '6085550999')])).toHaveLength(2);
  });

  it('keys a recipient by name and contacts', () => {
    expect(recipientKey(person('Ana', null, '1'))).toBe('Ana|Lee||1');
  });
});

describe('WhatsApp links', () => {
  it('takes ten digits as a US number and keeps a country code that is there', () => {
    expect(whatsappNumber('(608) 555-0111')).toBe('16085550111');
    expect(whatsappNumber('+1 608 555 0111')).toBe('16085550111');
    expect(whatsappNumber('+44 7700 900123')).toBe('447700900123');
    expect(whatsappNumber('555-0100')).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });

  it('types out a default greeting or the custom message, with the link', () => {
    const link = 'https://dancewithb.fun/feedback/abc';
    const url = whatsappUrl('16085550111', feedbackMessage(null, 'Ana', 'Bachata', link));
    expect(url.startsWith('https://wa.me/16085550111?text=')).toBe(true);
    const text = decodeURIComponent(url.split('text=')[1]);
    expect(text).toContain('Hi Ana! Thanks for dancing with us at Bachata');
    expect(text).toContain(link);
    expect(feedbackMessage('See you soon!', 'Ana', 'Bachata', link)).toMatch(/^See you soon!\n\n.*abc$/s);
  });
});

describe('questionnaire items', () => {
  it('saves what the builder sent, with new ids where needed and only real fields', () => {
    const items = cleanItems([{ kind: 'multi', text: ' Pick ', required: true, junk: 1, options: [{ label: ' A ' }, { label: 'B' }, { label: '  ' }] }]);
    expect(items).toMatchObject([{ kind: 'multi', text: 'Pick', required: true, options: [{ label: 'A' }, { label: 'B' }] }]);
    expect((items as FeedbackItem[])[0]).not.toHaveProperty('junk');
    expect((items as FeedbackItem[])[0].id).toBeTruthy();
  });

  it('refuses a questionnaire that can\'t work, saying what to fix', () => {
    expect(cleanItems('nope')).toMatch(/up to/);
    expect(cleanItems([])).toBe('Add at least one question.');
    expect(cleanItems([{ kind: 'message', text: 'Only words' }])).toBe('Add at least one question.');
    expect(cleanItems([{ kind: 'faces', text: ' ' }])).toMatch(/question is empty/);
    expect(cleanItems([{ kind: 'nope', text: 'x' }])).toMatch(/unknown type/);
    expect(cleanItems([{ kind: 'single', text: 'One choice', options: [{ label: 'A' }] }])).toMatch(/between 2 and/);
  });

  it('never lets a message be required', () => {
    expect(cleanItems([{ kind: 'message', text: 'Hi', required: true }, faces])).toMatchObject([{ kind: 'message' }, { kind: 'faces' }]);
    expect((cleanItems([{ kind: 'message', text: 'Hi', required: true }, faces]) as FeedbackItem[])[0]).not.toHaveProperty('required');
  });

  it('only accepts answers the question could have', () => {
    expect(cleanAnswer(faces, '5')).toBe(5);
    expect(cleanAnswer(faces, '6')).toBeUndefined();
    expect(cleanAnswer(faces, '1.5')).toBeUndefined();
    expect(cleanAnswer(scale, '0')).toBe(0);
    expect(cleanAnswer(scale, '')).toBeUndefined();
    expect(cleanAnswer(yesno, 'yes')).toBe('yes');
    expect(cleanAnswer(yesno, 'maybe')).toBeUndefined();
    expect(cleanAnswer(single, 'o1')).toBe('o1');
    expect(cleanAnswer(single, 'other')).toBeUndefined();
    expect(cleanAnswer(multi, ['o1', 'o1', 'other', 'o2'])).toEqual(['o1', 'o2']);
    expect(cleanAnswer(multi, 'o1')).toEqual(['o1']);
    expect(cleanAnswer(typed, '  hi ')).toBe('hi');
    expect(cleanAnswer(typed, '   ')).toBeUndefined();
    expect(cleanAnswer(hello, 'x')).toBeUndefined();
  });

  it('counts a scale answer of 0 as answering a required question', () => {
    const required = { ...scale, required: true };
    expect(missingRequired([required], { s: 0 })).toEqual([]);
    expect(missingRequired([required], {})).toEqual([required]);
  });

  it('fills in {class} and {name}, greeting a shared link with no name', () => {
    expect(fillIn('Hi {name}, how was {CLASS}?', { className: '$& Co', name: 'Ana' })).toBe('Hi Ana, how was $& Co?');
    expect(fillIn('Hi {name}!', { className: 'x' })).toBe('Hi there!');
  });

  it('takes the messages before the first question as the top message', () => {
    expect(topMessage([hello, { ...hello, id: 'm2', text: 'More' }, faces, { ...hello, id: 'm3', text: 'Later' }])).toBe(`${hello.text}\n\nMore`);
    expect(topMessage([faces, hello])).toBe('');
  });

  it("swaps in a request's own message, leaving later ones alone", () => {
    const later = { ...hello, id: 'later' };
    const swapped = withTopMessage([hello, faces, later], 'New words');
    expect(swapped.map((i) => i.text)).toEqual(['New words', faces.text, later.text]);
    expect(withTopMessage([hello, faces], '  ').map((i) => i.id)).toEqual(['f']);
  });

  it('offers one-tap answers only for a first question that fits an email', () => {
    expect(emailChoices([hello, faces])?.choices).toHaveLength(5);
    expect(emailChoices([yesno, typed])?.choices.map((c) => c.value)).toEqual(['yes', 'no']);
    expect(emailChoices([single])?.choices).toHaveLength(3);
    expect(emailChoices([{ ...single, options: choices(6) }])).toBeNull();
    expect(emailChoices([multi, faces])).toBeNull();
    expect(emailChoices([scale, faces])).toBeNull();
    expect(emailChoices([typed, faces])).toBeNull();
  });
});

describe('feedback results', () => {
  const answered = (answers: Record<string, number | string | string[]>, contact: string | null = null) => ({ answers, created_at: '2026-11-01T10:15:30Z', contact });

  it('counts each face, best first, and averages them', () => {
    const s = summarizeItem(faces, [answered({ f: 5 }), answered({ f: 4 }), answered({ f: 5 }), answered({ f: 2 }), answered({})]);
    expect(s.count).toBe(4);
    expect(s.average).toBe(4);
    expect(s.bars.map((b) => b.count)).toEqual([2, 1, 0, 1, 0]);
  });

  it('averages a scale that includes 0', () => {
    expect(summarizeItem(scale, [answered({ s: 0 }), answered({ s: 10 })]).average).toBe(5);
  });

  it('counts each choice, a person once per choice they picked', () => {
    const s = summarizeItem(multi, [answered({ k: ['o0', 'o1'] }), answered({ k: ['o1'] })]);
    expect(s.count).toBe(2);
    expect(s.bars.map((b) => b.count)).toEqual([1, 2, 0]);
  });

  it('lists written answers with their time, and a name only if shared', () => {
    const s = summarizeItem(typed, [answered({ t: 'Great' }), answered({ t: 'Hot room' }, 'Sam')]);
    expect(s.written).toEqual([
      { text: 'Great', at: '2026-11-01T10:15:30Z', contact: null },
      { text: 'Hot room', at: '2026-11-01T10:15:30Z', contact: 'Sam' },
    ]);
  });
});

describe('feedback email', () => {
  const base = { firstName: '<Ana>', className: 'Class & Co', link: 'https://dancewithb.fun/feedback/abc' };

  it('links each of the five faces to the dancer page with that answer, escaping what was typed', () => {
    const html = buildFeedbackEmailHtml({ ...base, items: [{ ...faces, text: 'How was "{class}"?' }, typed] });
    expect([...html.matchAll(/href="https:\/\/dancewithb\.fun\/feedback\/abc\?q=f&amp;a=(\d)"/g)].map((m) => m[1])).toEqual(['1', '2', '3', '4', '5']);
    // Five even columns that shrink with the screen, so the last face stays inside the card on a phone.
    expect(html).toContain('table-layout:fixed');
    expect(html).not.toMatch(/width:60px/);
    expect(html).toContain('Hi &lt;Ana&gt;,');
    expect(html).toContain('How was &quot;Class &amp; Co&quot;?');
    expect(html).toContain('After tapping there is 1 more quick question.');
  });

  it('is set in the site email look: "We welcome your feedback!" in the dark header, WhatsApp in the footer only with a link', () => {
    const html = buildFeedbackEmailHtml({ ...base, items: [faces] });
    expect(html).toContain('We welcome your feedback!</h1>');
    expect(html).toContain('bgcolor="#170f0d"');
    expect(html).not.toContain('email/whatsapp.png');
    expect(buildFeedbackEmailHtml({ ...base, items: [faces], whatsappUrl: 'https://chat.whatsapp.com/AbC123' })).toContain('email/whatsapp.png');
  });

  it('opens with the custom message instead of the greeting', () => {
    const html = buildFeedbackEmailHtml({ ...base, firstName: 'Ana', items: [hello, faces] });
    expect(html).toContain('Hi Ana!<br/>Thanks for Class &amp; Co.');
    expect(html).not.toContain('Thanks for dancing with us');
  });

  it('shows an Answer button when the first question can\'t be tapped', () => {
    const items = [typed, faces];
    const html = buildFeedbackEmailHtml({ ...base, items });
    expect(html).toContain('href="https://dancewithb.fun/feedback/abc"');
    expect(html).toContain('>Answer</a>');
    expect(html).not.toContain('?q=');
    expect(feedbackEmailSubject({ className: 'Bachata', items })).toBe('A quick question about Bachata');
    expect(feedbackEmailSubject({ className: 'Bachata', items: [faces] })).toBe('How was Bachata?');
  });

  it('stacks yes/no and short pick-one answers as buttons', () => {
    const html = buildFeedbackEmailHtml({ ...base, items: [yesno] });
    expect(html).toContain('?q=y&amp;a=yes');
    expect(html).toContain('?q=y&amp;a=no');
  });
});

describe('dancers typed into a request', () => {
  it('skips blank rows, tidies the rest and asks a repeated dancer once', () => {
    expect(
      cleanTypedPeople([
        { firstName: ' Ana ', lastName: '', email: 'ANA@example.com ', phone: '' },
        { firstName: '', lastName: '', email: '', phone: '' },
        { firstName: 'Ana', lastName: '', email: 'ana@example.com', phone: '6085550111' },
        { firstName: 'Ben', phone: '+34 600 000 000' },
      ])
    ).toEqual({
      people: [
        { firstName: 'Ana', lastName: '', email: 'ana@example.com', phone: '6085550111' },
        { firstName: 'Ben', lastName: '', email: null, phone: '+34 600 000 000' },
      ],
    });
    expect(cleanTypedPeople(undefined)).toEqual({ people: [] });
  });

  it('refuses a WhatsApp number typed without its country code, or with words in it', () => {
    expect(typedPhoneProblem('07700 900123')).toEqual(expect.stringContaining('country code'));
    expect(typedPhoneProblem('call 608 555 0111 ext 2')).toEqual(expect.stringContaining('only digits'));
    expect(typedPhoneProblem('+44 7700 900123')).toBeNull();
    expect(typedPhoneProblem('(608) 555-0111')).toBeNull();
    expect(typedPhoneProblem('1 608 555 0111')).toBeNull();
    expect(cleanTypedPeople([{ firstName: 'Ana', phone: '07700 900123' }])).toMatchObject({ error: expect.stringContaining("Ana's WhatsApp number") });
  });

  it('refuses contact details longer than any real one', () => {
    expect(cleanTypedPeople([{ firstName: 'Ana', email: `${'a'.repeat(250)}@example.com` }])).toEqual({ error: "Ana's email doesn't look right." });
    expect(cleanTypedPeople([{ firstName: 'Ana', phone: `+1 608 555 0111${' '.repeat(40)}` }])).toEqual({ people: [expect.objectContaining({ phone: '+1 608 555 0111' })] });
    expect(cleanTypedPeople([{ firstName: 'Ana', phone: `+1 608${'-'.repeat(40)}555 0111` }])).toMatchObject({ error: expect.stringContaining("Ana's WhatsApp number") });
  });

  it('tells dancers their answers are anonymous in words that fit the link', () => {
    expect(anonymityNote(false, 'invite')).toBe('Your answers are anonymous.');
    expect(anonymityNote(true, 'invite')).toBe('Your answers are anonymous unless you choose to share your name.');
    expect(anonymityNote(true, 'shared')).toBe('Your answers are anonymous unless you leave your details.');
  });

  it('refuses anyone the request could never reach, naming them', () => {
    expect(cleanTypedPeople([{ lastName: 'Lee', email: 'lee@example.com' }])).toEqual({ error: 'Add a first name for Lee.' });
    expect(cleanTypedPeople([{ firstName: 'Ana' }])).toEqual({ error: 'Add an email or WhatsApp number for Ana.' });
    expect(cleanTypedPeople([{ firstName: 'Ana', email: 'ana@example' }])).toEqual({ error: "Ana's email doesn't look right." });
    expect(cleanTypedPeople([{ firstName: 'Ana', phone: '12345' }])).toMatchObject({ error: expect.stringContaining('WhatsApp number') });
    expect(cleanTypedPeople('Ana')).toMatchObject({ error: expect.any(String) });
    expect(cleanTypedPeople([null, 'Ana'])).toEqual({ people: [] });
  });
});
