import { test, expect } from './support/fixtures';
import { db, seedEvent, seedSignup, sweepTestData, testTitle } from './support/db';
import { RUN_ID } from './support/env';
import { recipients, sunkEmails } from './support/emails';
import { bearer, signInBrowser } from './support/admin';

// Feedback requests (migrations 0064-0066): building a questionnaire, who's
// asked, the custom message, one-tap answers from the email, the WhatsApp
// message, the link anyone can use, and that answers stay anonymous.
test.afterAll(sweepTestData);

const emailOf = (who: string) => `zzz-e2e-${RUN_ID.toLowerCase()}-${who}@example.com`;
const tapLink = (html: string, answer: string) => html.match(new RegExp(`href="([^"]*/feedback/[\\w-]+\\?q=[^"]*a=${answer})"`))?.[1].replace(/&amp;/g, '&') ?? '';
const LINK = /https?:\/\/\S+\/feedback\/[\w-]+/;

const rating = { id: 'rate', kind: 'faces', text: 'How was {class}?' };
const focus = { id: 'focus', kind: 'multi', text: 'What should we do more of?', options: [{ id: 'turns', label: 'Turn patterns' }, { id: 'music', label: 'Musicality' }, { id: 'feet', label: 'Footwork' }] };
const again = { id: 'again', kind: 'yesno', text: 'Would you recommend this class?', required: true };
const comment = { id: 'more', kind: 'text', text: 'Anything else?' };

async function seedQuestionnaire(name: string, items: unknown[], contactBox = true) {
  const { data, error } = await db.from('feedback_questionnaires').insert({ name: testTitle(name), items, contact_box: contactBox }).select('id, name').single();
  if (error || !data) throw new Error(`Seeding a questionnaire failed: ${error?.message}`);
  return data as { id: string; name: string };
}

async function responses(campaignId: string) {
  const { data } = await db.from('feedback_responses').select('answers, via, created_at, finished_at, contact_name, contact_email, contact_phone').eq('campaign_id', campaignId);
  return data ?? [];
}

async function pickOption(page: import('@playwright/test').Page, select: string, text: string) {
  await expect(page.locator(`${select} option`, { hasText: text }).first()).toBeAttached();
  await page.locator(select).selectOption((await page.locator(`${select} option`, { hasText: text }).first().getAttribute('value'))!);
}

test('the builder: Add question opens the types, picking one makes the question, and messages and order are saved', async ({ page, adminPage }) => {
  void adminPage;
  const name = testTitle('Built');
  await page.goto('/admin/feedback');
  await page.locator('#tab-questionnaires').click();
  await page.locator('#qn-new').click();
  await page.locator('#qn-name').fill(name);

  // One button until it's pressed, then a block of types; Cancel goes back.
  await expect(page.locator('.fb-picker')).toHaveCount(0);
  await page.locator('.fb-add').click();
  await expect(page.locator('.fb-picker .fb-kind')).toHaveCount(7);
  await expect(page.locator('.fb-add')).toHaveCount(0);
  await page.locator('.fb-picker').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.fb-picker')).toHaveCount(0);

  const add = async (kind: string) => {
    await page.locator('.fb-add').click();
    await page.locator(`.fb-kind[data-kind="${kind}"]`).click();
    await expect(page.locator('.fb-picker')).toHaveCount(0);
  };
  await add('faces');
  await add('text');
  await add('multi');
  await expect(page.locator('.fb-item')).toHaveCount(3);

  // A message goes to the top, and the preview shows it filled in.
  await add('message');
  await expect(page.locator('.fb-item').first()).toHaveAttribute('data-kind', 'message');
  await page.locator('.fb-item').first().locator('.fb-text').fill('Hi {name}, thanks for coming!');
  await expect(page.locator('#qn-preview')).toContainText('Hi Maria, thanks for coming!');

  // A question with choices can have more added.
  const choices = page.locator('.fb-item[data-kind="multi"]');
  await choices.locator('.fb-add-option').click();
  await expect(choices.locator('.fb-option')).toHaveCount(3);
  await choices.locator('.fb-required').check();

  const kinds = () => page.locator('.fb-item').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.kind));
  expect(await kinds()).toEqual(['message', 'faces', 'text', 'multi']);

  // Arrows, keeping focus on the button so it can be pressed again.
  await page.locator('.fb-item[data-kind="multi"] .fb-move-up').click();
  expect(await kinds()).toEqual(['message', 'faces', 'multi', 'text']);
  await expect(page.locator('.fb-item[data-kind="multi"] .fb-move-up')).toBeFocused();

  // Dragging the dots.
  const first = await page.locator('.fb-item').first().boundingBox();
  const grip = await page.locator('.fb-item[data-kind="text"] .fb-grip').boundingBox();
  await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip!.x + grip!.width / 2, first!.y + 2, { steps: 8 });
  await page.mouse.up();
  expect(await kinds()).toEqual(['text', 'message', 'faces', 'multi']);

  // Deleting.
  await page.locator('.fb-item[data-kind="text"] .fb-delete').click();
  expect(await kinds()).toEqual(['message', 'faces', 'multi']);

  await page.locator('#qn-save').click();
  await expect(page.locator('#qn-status')).toHaveText('Saved.');
  const { data } = await db.from('feedback_questionnaires').select('id, items, updated_at').eq('name', name).single();
  expect(data!.items.map((i: { kind: string }) => i.kind)).toEqual(['message', 'faces', 'multi']);
  expect(data!.items[2].required).toBe(true);
  expect(data!.items[2].options).toHaveLength(3);

  // Saving again works; saving over someone else's newer save doesn't.
  await page.locator('#qn-save').click();
  await expect(page.locator('#qn-save')).toBeEnabled();
  await expect(page.locator('#qn-status')).toHaveText('Saved.');
  await db.from('feedback_questionnaires').update({ updated_at: new Date(Date.now() + 1000).toISOString() }).eq('id', data!.id);
  await page.locator('#qn-save').click();
  await expect(page.locator('#qn-status')).toContainText('Someone else changed this questionnaire');

  // Nothing to answer can't be saved.
  await page.locator('#qn-back').click();
  await page.locator('#qn-new').click();
  await page.locator('#qn-name').fill(testTitle('Empty'));
  await page.locator('#qn-save').click();
  await expect(page.locator('#qn-status')).toHaveText('Add at least one question.');

  await page.locator('#qn-back').click();
  const row = page.locator('.fb-questionnaire', { hasText: name });
  await expect(row).toContainText('2 questions');
  await row.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.locator('.fb-questionnaire', { hasText: `${name} (copy)` })).toBeVisible();

  // Unused ones are deleted outright.
  page.on('dialog', (d) => d.accept());
  await page.locator('.fb-questionnaire', { hasText: `${name} (copy)` }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.fb-questionnaire', { hasText: `${name} (copy)` })).toHaveCount(0);
});

test('on a phone, dragging the dots reorders questions', async ({ browser, adminSession }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
  await signInBrowser(context, adminSession);
  const page = await context.newPage();
  await page.goto('/admin/feedback');
  await page.locator('#tab-questionnaires').click();
  await page.locator('#qn-new').click();
  for (const kind of ['faces', 'yesno', 'text']) {
    await page.locator('.fb-add').click();
    await page.locator(`.fb-kind[data-kind="${kind}"]`).click();
  }
  const firstBox = await page.locator('.fb-item').first().boundingBox();
  const grip = await page.locator('.fb-item[data-kind="text"] .fb-grip').boundingBox();
  const x = grip!.x + grip!.width / 2;
  const cdp = await context.newCDPSession(page);
  const touch = (type: string, y?: number) => cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: y === undefined ? [] : [{ x, y }] });
  await touch('touchStart', grip!.y + grip!.height / 2);
  for (const y of [grip!.y - 60, grip!.y - 160, firstBox!.y + 2]) await touch('touchMove', y);
  await touch('touchEnd');
  await expect.poll(() => page.locator('.fb-item').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.kind))).toEqual(['text', 'faces', 'yesno']);
  await expect(page.locator('#qn-preview p').first()).toContainText('Anything else?');
  await context.close();
});

test('an admin asks who came with their own message; dancers answer from the email and WhatsApp, anonymously', async ({ page, context, request, adminPage, admin }) => {
  void adminPage;
  const klass = await seedEvent({ name: 'Feedback Class', occurrences: 2 });
  const questionnaire = await seedQuestionnaire('Series Questions', [{ id: 'hello', kind: 'message', text: 'From the questionnaire' }, rating, focus, again, comment]);
  // Ana signed up with her email and came twice (checking in by phone); Ben came once; Cat walked in; Dee never came.
  await seedSignup(klass, [
    { first: 'Ana', email: emailOf('ana'), phone: '6085550111' },
    { first: 'Ben', phone: '6085550122' },
    { first: 'Dee', email: emailOf('dee'), phone: '6085550144' },
  ]);
  const checkin = (first: string, phone: string, occurrence: number) => ({ first_name: `ZZZ${first}`, last_name: RUN_ID, phone, class_title: klass.title, event_id: klass.ids[occurrence] });
  const { error } = await db.from('class_checkins').insert([checkin('Ana', '6085550111', 0), checkin('Ana', '6085550111', 1), checkin('Ben', '6085550122', 0), checkin('Cat', '6085550133', 1)]);
  expect(error).toBeNull();

  await page.goto('/admin/feedback');
  const option = page.locator('#fb-target option', { hasText: klass.title }).filter({ hasText: 'whole series' });
  await page.locator('#fb-target').selectOption((await option.getAttribute('value'))!);
  const rows = page.locator('.fb-recipient');
  // Each dancer who came once, Ana with the email she signed up with; never Dee.
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'ZZZAna' })).toContainText(emailOf('ana'));
  await expect(rows.filter({ hasText: 'ZZZAna' })).toContainText('Email + WhatsApp');
  await expect(page.locator('#fb-recipients')).not.toContainText('ZZZDee');

  // The message starts from the questionnaire's and changes for this request only.
  await pickOption(page, '#fb-questionnaire', questionnaire.name);
  await expect(page.locator('#fb-message')).toHaveValue('From the questionnaire');
  await expect(page.locator('#fb-tap-note')).toContainText('one tap');
  await page.locator('#fb-message').fill('Hi {name}! Last week of {class}, thank you.');

  const before = sunkEmails().length;
  await page.locator('#fb-create').click();
  await expect(page.locator('#fb-status')).toContainText('1 email sent');
  const sent = sunkEmails().slice(before);
  expect(sent.map((e) => recipients(e))).toEqual([[emailOf('ana')]]);
  expect(sent[0].subject).toBe(`How was ${klass.title}?`);
  expect(sent[0].html).toContain(`Hi ZZZAna! Last week of ${klass.title}, thank you.`);
  expect(sent[0].html).not.toContain('From the questionnaire');

  const { data: campaign } = await db.from('feedback_campaigns').select('id, items').eq('class_title', klass.title).single();
  const campaignId = campaign!.id as string;

  // A mail scanner following the email's links answers nothing.
  const link5 = tapLink(sent[0].html, '5');
  expect(link5).toContain('/feedback/');
  expect((await request.get(link5)).status()).toBe(200);
  expect(await responses(campaignId)).toEqual([]);

  // Ana taps a face: it's saved at once, with her message at the top, questions in order.
  await page.goto(link5);
  await expect(page.locator('#feedback-status')).toHaveText('Saved');
  await expect(page.locator('.feedback-message')).toContainText(`Hi ZZZAna! Last week of ${klass.title}, thank you.`);
  await expect(page.locator('.feedback-question legend').first()).toContainText(`How was ${klass.title}?`);
  expect(await page.locator('.feedback-question').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.kind))).toEqual(['faces', 'multi', 'yesno', 'text']);
  expect((await responses(campaignId))[0].answers).toEqual({ rate: 5 });

  // Leaving now would still count; each further answer saves as she goes.
  await page.getByText('Turn patterns').click();
  await page.getByText('Footwork').click();
  await expect.poll(async () => (await responses(campaignId))[0].answers.focus).toEqual(['turns', 'feet']);
  await page.locator('.feedback-question[data-kind="text"] textarea').fill('ZZZ more turn patterns please');
  await expect.poll(async () => (await responses(campaignId))[0].answers.more).toBe('ZZZ more turn patterns please');

  // Done needs the required question; nothing is lost when the browser's own check is bypassed.
  await page.locator('#feedback-form').evaluate((f) => ((f as HTMLFormElement).noValidate = true));
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('alert')).toContainText('marked with a star');
  await expect(page.locator('.feedback-question[data-kind="text"] textarea')).toHaveValue('ZZZ more turn patterns please');
  expect((await responses(campaignId))[0].finished_at).toBeNull();
  await page.locator('.feedback-question[data-kind="yesno"]').getByText('yes').click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('main h1')).toHaveText('Thank you!');
  const [ana] = await responses(campaignId);
  expect(ana.finished_at).not.toBeNull();
  expect(ana.contact_name).toBeNull();
  expect(ana.answers).toEqual({ rate: 5, focus: ['turns', 'feet'], again: 'yes', more: 'ZZZ more turn patterns please' });

  // Tapping another face in the email changes her answer rather than adding one.
  await page.goto(tapLink(sent[0].html, '3'));
  await expect(page.locator('#feedback-status')).toHaveText('Saved');
  await expect.poll(async () => (await responses(campaignId)).map((r) => r.answers.rate)).toEqual([3]);

  // Ben gets a WhatsApp message (the button opens it) with the custom message, answers, and shares his name.
  await context.route('https://wa.me/**', (route) => route.fulfill({ body: 'WhatsApp' }));
  await page.goto('/admin/feedback');
  const card = page.locator('.fb-campaign', { hasText: klass.title });
  await expect(card.locator('.fb-counts')).toHaveText('1 of 3 started · 1 finished');
  await expect(card).toContainText('ZZZ more turn patterns please');
  await expect(card.locator('.fb-summary').first()).toContainText(`How was ${klass.title}?`);
  await expect(card.locator('.fb-comment')).not.toContainText('ZZZAna');
  await card.locator('summary', { hasText: 'Send on WhatsApp (3)' }).click();
  const popup = page.waitForEvent('popup');
  await card.locator('li', { hasText: 'ZZZBen' }).getByRole('button', { name: 'Send on WhatsApp' }).click();
  const whatsapp = await popup;
  await whatsapp.waitForURL(/wa\.me/);
  const url = new URL(whatsapp.url());
  expect(url.pathname).toBe('/16085550122');
  const message = url.searchParams.get('text')!;
  expect(message).toContain(`Hi ZZZBen! Last week of ${klass.title}, thank you.`);
  const benLink = message.match(LINK)![0];
  await whatsapp.close();

  await page.goto(benLink);
  await page.locator('.feedback-question[data-kind="faces"]').getByText('Good').click();
  await page.locator('.feedback-question[data-kind="yesno"]').getByText('no', { exact: true }).click();
  await page.getByLabel(/You may contact me/).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('main h1')).toHaveText('Thank you!');
  expect((await responses(campaignId)).find((r) => r.answers.rate === 4)?.contact_name).toBe(`ZZZBen ${RUN_ID}`);

  // "Change my answers" brings back what was saved.
  await page.getByRole('link', { name: 'Change my answers' }).click();
  await expect(page.locator('.feedback-question[data-kind="yesno"] input[value="no"]')).toBeChecked();

  // Ana's WhatsApp link, after she answered by email, doesn't count her twice.
  const { data: anaInvite } = await db.from('feedback_invites').select('id').eq('campaign_id', campaignId).eq('first_name', 'ZZZAna').single();
  const res = await request.post('/api/admin/feedback', { headers: bearer(admin), data: { action: 'whatsapp', inviteId: anaInvite!.id } });
  const anaLink = new URL((await res.json()).url).searchParams.get('text')!.match(LINK)![0];
  await page.goto(anaLink);
  await expect(page.locator('body')).toContainText('We already have your answers.');
  expect(await responses(campaignId)).toHaveLength(2);

  // Results by question; who answered is never sent to the admin page.
  const listed = await (await request.get('/api/admin/feedback', { headers: bearer(admin) })).json();
  const mine = listed.campaigns.find((c: { id: string }) => c.id === campaignId);
  expect(mine.invites.every((i: Record<string, unknown>) => !('responded' in i))).toBe(true);
  expect(mine.stats).toEqual({ started: 2, shared: 0, finished: 2 });
  expect(mine.summaries.find((s: { id: string }) => s.id === 'rate').average).toBe(3.5);
  expect(mine.summaries.find((s: { id: string }) => s.id === 'focus').bars.map((b: { count: number }) => b.count)).toEqual([1, 0, 1]);
  expect(mine.contacts[0]).toContain('ZZZBen');

  // Editing the questionnaire later leaves this request as it was sent.
  await db.from('feedback_questionnaires').update({ items: [rating] }).eq('id', questionnaire.id);
  await page.goto(benLink);
  await expect(page.locator('.feedback-question')).toHaveCount(4);

  // Answers keep the exact time they came in (migration 0065), not a rounded one.
  const times = await responses(campaignId);
  expect(times).toHaveLength(2);
  for (const t of times) expect(Date.parse(t.created_at) % (60 * 60 * 1000)).not.toBe(0);

  // A closed request takes no more answers; a used questionnaire is hidden rather than deleted.
  await request.post('/api/admin/feedback', { headers: bearer(admin), data: { action: 'close', campaignId } });
  await page.goto(benLink);
  await expect(page.locator('body')).toContainText('This feedback request has closed');
  await request.post('/api/admin/feedback-questionnaires', { headers: bearer(admin), data: { action: 'delete', id: questionnaire.id } });
  const { data: hidden } = await db.from('feedback_questionnaires').select('hidden_at').eq('id', questionnaire.id).single();
  expect(hidden!.hidden_at).not.toBeNull();
});

test('the link anyone can use: no dancers needed, each browser answers once, and contact details are optional', async ({ page, browser, adminPage }) => {
  void adminPage;
  const klass = await seedEvent({ name: 'Shared Class' });
  await db.from('class_checkins').insert({ first_name: 'ZZZSolo', last_name: RUN_ID, phone: '6085550155', class_title: klass.title, event_id: klass.ids[0] });
  const questionnaire = await seedQuestionnaire('Shared Questions', [{ id: 'hello', kind: 'message', text: 'Hi {name}, thanks for {class}!' }, rating, comment]);

  await page.goto('/admin/feedback');
  await pickOption(page, '#fb-target', klass.title);
  await expect(page.locator('.fb-recipient')).toHaveCount(1);
  await pickOption(page, '#fb-questionnaire', questionnaire.name);
  await page.locator('.fb-recipient input').uncheck();
  const before = sunkEmails().length;
  await page.locator('#fb-create').click();
  await expect(page.locator('#fb-status')).toContainText('0 emails sent');
  expect(sunkEmails().length).toBe(before);

  const card = page.locator('.fb-campaign', { hasText: klass.title });
  const shared = await card.locator('.fb-share').inputValue();
  expect(shared).toMatch(/\/feedback\/s-/);
  const { data: campaign } = await db.from('feedback_campaigns').select('id').eq('class_title', klass.title).single();
  const campaignId = campaign!.id as string;

  // Opening it saves nothing and greets nobody by name.
  const visitor = await browser.newContext();
  const first = await visitor.newPage();
  await first.goto(shared);
  await expect(first.locator('.feedback-message')).toContainText(`Hi there, thanks for ${klass.title}!`);
  expect(await responses(campaignId)).toEqual([]);

  await first.locator('.feedback-question[data-kind="faces"]').getByText('Loved it').click();
  await expect(first.locator('#feedback-status')).toHaveText('Saved');
  await first.locator('.feedback-question[data-kind="faces"]').getByText('Okay').click();
  await expect.poll(async () => (await responses(campaignId)).map((r) => r.answers.rate)).toEqual([3]);

  // Coming back in the same browser carries on with the same answers.
  await first.reload();
  await expect(first.locator('.feedback-question[data-kind="faces"] input[value="3"]')).toBeChecked();
  await first.locator('input[name="contact_name"]').fill('ZZZ Visitor');
  await first.locator('input[name="contact_way"]').fill('visitor@example.com');
  await first.getByRole('button', { name: 'Done' }).click();
  await expect(first.locator('main h1')).toHaveText('Thank you!');
  const [saved] = await responses(campaignId);
  expect(saved).toMatchObject({ via: 'shared', contact_name: 'ZZZ Visitor', contact_email: 'visitor@example.com' });
  await visitor.close();

  // Another browser is another answer, anonymous unless it says otherwise.
  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto(shared);
  await expect(second.locator('.feedback-question[data-kind="faces"] input:checked')).toHaveCount(0);
  await second.locator('.feedback-question[data-kind="faces"]').getByText('Good').click();
  await expect(second.locator('#feedback-status')).toHaveText('Saved');
  await other.close();
  const both = await responses(campaignId);
  expect(both).toHaveLength(2);
  expect(both.find((r) => r.answers.rate === 4)?.contact_name).toBeNull();

  await page.reload();
  await expect(card.locator('.fb-counts')).toHaveText('1 finished · 2 from the shared link');
  await expect(card.locator('.fb-contacts')).toContainText('ZZZ Visitor');
});

test('a request about no class at all; a typed first question gets an Answer button in the email', async ({ page, request, adminPage, admin }) => {
  void adminPage;
  const questionnaire = await seedQuestionnaire('General', [comment, rating], false);
  await page.goto('/admin/feedback');
  await page.locator('#fb-target').selectOption('general');
  await expect(page.locator('#fb-who-box')).toBeHidden();
  await pickOption(page, '#fb-questionnaire', questionnaire.name);
  await expect(page.locator('#fb-tap-note')).toContainText('Answer button');
  await page.locator('#fb-create').click();
  await expect(page.locator('.fb-campaign', { hasText: questionnaire.name })).toBeVisible();

  const { data: campaign } = await db.from('feedback_campaigns').select('id, share_token, scope').eq('title', questionnaire.name).single();
  expect(campaign!.scope).toBe('general');
  await page.goto(`/feedback/s-${campaign!.share_token}`);
  // {class} reads as the business; no contact offer when the questionnaire turned it off.
  await expect(page.locator('.feedback-question legend').nth(1)).toContainText('How was Dance with B?');
  await expect(page.locator('input[name="contact_name"]')).toHaveCount(0);

  // Done with nothing answered asks for an answer and saves nothing.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('alert')).toContainText('at least one');
  expect(await responses(campaign!.id)).toEqual([]);

  // Same questionnaire on a class, emailed: the Answer button, no one-tap links.
  const klass = await seedEvent({ name: 'Typed First' });
  await seedSignup(klass, [{ first: 'Gia', email: emailOf('gia') }]);
  await db.from('class_checkins').insert({ first_name: 'ZZZGia', last_name: RUN_ID, phone: '5550100', class_title: klass.title, event_id: klass.ids[0] });
  const query = new URLSearchParams({ scope: 'occurrence', seriesKey: klass.key, eventId: klass.ids[0] });
  const { keys } = await (await request.get(`/api/admin/feedback?${query}`, { headers: bearer(admin) })).json();
  const before = sunkEmails().length;
  const created = await request.post('/api/admin/feedback', {
    headers: bearer(admin),
    data: { action: 'create', questionnaireId: questionnaire.id, message: '', keys, scope: 'occurrence', seriesKey: klass.key, eventId: klass.ids[0] },
  });
  expect((await created.json()).emailed).toBe(1);
  const [email] = sunkEmails().slice(before);
  expect(email.subject).toBe(`A quick question about ${klass.title}`);
  expect(email.html).toContain('>Answer</a>');
  expect(email.html).not.toContain('?q=');
});

test('an event asks everyone who signed up; a bad link says so', async ({ page, request, admin }) => {
  const event = await seedEvent({ name: 'Feedback Event', type: 'event' });
  await seedSignup(event, [{ first: 'Eve', email: emailOf('eve') }, { first: 'Fay', phone: '+44 7700 900123' }], 'events');

  const query = new URLSearchParams({ scope: 'event', seriesKey: event.key, eventId: event.ids[0] });
  const res = await request.get(`/api/admin/feedback?${query}`, { headers: bearer(admin) });
  expect(res.status()).toBe(200);
  const { recipients: people } = await res.json();
  expect(people.map((p: { firstName: string }) => p.firstName).sort()).toEqual(['ZZZEve', 'ZZZFay']);

  await page.goto('/feedback/not-a-real-feedback-link-at-all');
  await expect(page.locator('body')).toContainText("This feedback link isn't valid");
});
