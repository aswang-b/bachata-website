import { test, expect, postForm } from './support/fixtures';
import { db, seedEvent, testTitle, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { emailsAbout } from './support/emails';
import { confirmationId, fillDancer, payCash, selectSeries, submitRegistration } from './support/forms';

// Bundle deals: made in admin → Deals, applied at registration (form and
// server alike), offered as an "Add" when a dancer is one class short, and
// shown on the receipt as their own line.
let intro: Seeded;
let open: Seeded;
const dealName = testTitle('Pop-Up Bundle');

test.beforeAll(async () => {
  intro = await seedEvent({ name: 'Deal Intro', priceWhole: 25, priceDropIn: 25, dayOffset: 40 });
  open = await seedEvent({ name: 'Deal Open Level', priceWhole: 25, priceDropIn: 25, dayOffset: 40 });
});

test.afterAll(async () => {
  await db.from('deals').delete().eq('name', dealName);
});

const dealRows = async (submissionId: string) =>
  (await db.from('class_registrations').select('class_title, price, deal_name, deal_discount').eq('submission_id', submissionId).order('class_title')).data ?? [];

test.describe.serial('a bundle price for two workshops', () => {
  test('an admin creates the deal in the Deals tab', async ({ page, adminPage }) => {
    void adminPage;
    await page.goto('/admin');
    await page.locator('.admin-tab-btn[data-tab="deals"]').click();
    await expect(page.locator('#deals-status')).toHaveText('');
    await page.locator('#deal-new').click();
    await page.locator('#deal-name').fill(dealName);
    await page.locator('#deal-kind').selectOption('bundle_price');
    await page.locator('#deal-amount').fill('40');
    for (const s of [intro, open]) await page.locator(`#deal-options input[value="${s.key}"]`).check();
    await expect(page.locator('#deal-preview')).toHaveText("Both for $40 (they're $50 today)");
    await page.locator('#deal-save').click();
    await expect(page.locator('#deals-status')).toHaveText('Saved.');
    await expect(page.locator('#deals-list')).toContainText(dealName);
    await page.locator('#admin-tab-panel-deals').screenshot({ path: 'tests/e2e/.output/deals-admin.png' });

    const { data } = await db.from('deals').select('kind, amount, series_keys, required_count, active').eq('name', dealName).single();
    expect(data).toMatchObject({ kind: 'bundle_price', amount: 40, required_count: null, active: true });
    expect([...data!.series_keys].sort()).toEqual([intro.key, open.key].sort());
  });

  test('the form offers the other class, and adding it takes the bundle price', async ({ page }) => {
    await page.goto('/register');
    await selectSeries(page, intro.key);
    const suggestion = page.locator('#deal-suggestions .deal-suggestion');
    await expect(suggestion).toHaveCount(1);
    await expect(suggestion).toContainText(`Add ${open.title} to get the ${dealName} and save $10.`);
    await expect(page.locator('#subtotal-value')).toHaveText('$25');
    await page.locator('#subtotal-row').screenshot({ path: 'tests/e2e/.output/deals-suggestion.png' });

    await suggestion.locator('.deal-add-btn').click();
    await expect(page.locator(`.series-item[data-key="${open.key}"]`)).toHaveAttribute('data-selected', 'true');
    await expect(page.locator('#deal-suggestions')).toBeHidden();
    await expect(page.locator('#subtotal-items .deal-line')).toContainText(dealName);
    await expect(page.locator('#subtotal-items .deal-line')).toContainText('−$10');
    await expect(page.locator('#subtotal-value')).toHaveText('$40');

    // Two dancers: each gets the deal.
    await fillDancer(page, 0, { first: 'DealOne', role: 'leader', email: `zzz-e2e-${RUN_ID.toLowerCase()}-deal@example.com` });
    await fillDancer(page, 1, { first: 'DealTwo', role: 'follower' });
    await expect(page.locator('#subtotal-value')).toHaveText('$80');
    await page.locator('#subtotal-row').screenshot({ path: 'tests/e2e/.output/deals-subtotal.png' });
    await payCash(page);
    await submitRegistration(page);
    await page.waitForURL(/\/register\/confirmation\?id=/);

    const rows = await dealRows(confirmationId(page.url())!);
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r).toMatchObject({ price: 20, deal_name: dealName, deal_discount: 5 });

    // The receipt: full prices, then the deal, adding up to the subtotal.
    const body = page.locator('body');
    await expect(body).toContainText(dealName);
    await expect(body).toContainText('−$20');
    await expect(body).toContainText('−$10 × 2 dancers');
    await expect(page.locator('li', { hasText: open.title })).toContainText('$50');
    await expect(body).toContainText(/Subtotal\s*\$80/);

    // The confirmation email itemizes it the same way.
    const sent = emailsAbout('ZZZDealOne');
    expect(sent.length).toBeGreaterThan(0);
    for (const e of sent) {
      expect(e.html).toContain(dealName);
      expect(e.html).toContain('−$20');
    }
  });

  test("the server prices it the same way, whatever the browser sends, and one class alone doesn't qualify", async ({ request }) => {
    const sel = (list: Seeded[]) => JSON.stringify(list.map((s) => ({ key: s.key, title: s.title, label: '', mode: null })));
    const dancers = JSON.stringify([{ firstName: 'ZZZDealApi', lastName: RUN_ID, role: 'leader', phone: '6085550177', email: '' }]);
    const both = await postForm(request, '/api/submit-intake', { registration_type: 'group', class: 'x', payment_method: 'cash', class_selections: sel([intro, open]), dancers });
    expect(both.status()).toBe(303);
    const bothRows = await dealRows(confirmationId(new URL(both.headers().location, 'http://x').toString())!);
    expect(bothRows.map((r) => r.price)).toEqual([20, 20]);

    const oneDancers = JSON.stringify([{ firstName: 'ZZZDealSolo', lastName: RUN_ID, role: 'leader', phone: '6085550178', email: '' }]);
    const one = await postForm(request, '/api/submit-intake', { registration_type: 'group', class: 'x', payment_method: 'cash', class_selections: sel([intro]), dancers: oneDancers });
    const oneRows = await dealRows(confirmationId(new URL(one.headers().location, 'http://x').toString())!);
    expect(oneRows).toEqual([expect.objectContaining({ price: 25, deal_name: null })]);
  });

  test('a paused deal stops applying', async ({ page }) => {
    await db.from('deals').update({ active: false }).eq('name', dealName);
    await page.goto('/register');
    await selectSeries(page, intro.key);
    await selectSeries(page, open.key);
    await expect(page.locator('#subtotal-value')).toHaveText('$50');
    await expect(page.locator('#subtotal-items .deal-line')).toHaveCount(0);
  });
});

test('a deal covers classes or events, never both', async ({ page, adminPage, request, admin }) => {
  void adminPage;
  const event = await seedEvent({ name: 'Deal Social', type: 'event', priceWhole: 10, dayOffset: 41 });
  const mixed = await request.post('/api/admin/deals', {
    headers: { Authorization: `Bearer ${admin.access_token}`, Origin: new URL(page.url() || 'http://localhost:4322').origin },
    data: { name: testTitle('Mixed Deal'), kind: 'amount_off', amount: 5, seriesKeys: [intro.key, event.key] },
  });
  expect(mixed.status()).toBe(400);
  expect((await mixed.json()).error).toBe('A deal can cover classes or events, not both.');

  // In the form, ticking a class locks the events (and the reverse).
  await page.goto('/admin');
  await page.locator('.admin-tab-btn[data-tab="deals"]').click();
  await page.locator('#deal-new').click();
  await page.locator(`#deal-options input[value="${intro.key}"]`).check();
  await expect(page.locator(`#deal-options input[value="${event.key}"]`)).toBeDisabled();
  await expect(page.locator('#deal-type-note')).toBeVisible();
  await page.locator(`#deal-options input[value="${intro.key}"]`).uncheck();
  await page.locator(`#deal-options input[value="${event.key}"]`).check();
  await expect(page.locator(`#deal-options input[value="${open.key}"]`)).toBeDisabled();
});

test('the Deals list labels each deal, live ones first, and keeps an end date through an edit', async ({ page, adminPage }) => {
  void adminPage;
  const { data: past } = await db
    .from('events')
    .insert({ title: testTitle('Past Workshop'), event_type: 'class', visibility: 'public', color: 'green', start_time: '2020-01-05T01:00:00Z', end_time: '2020-01-05T02:00:00Z', price_whole_series: 25 })
    .select('id')
    .single();
  const day = 86400000;
  const mixedEvent = await seedEvent({ name: 'Mixed Social', type: 'event', priceWhole: 10, dayOffset: 42 });
  const base = { kind: 'bundle_price', amount: 40, series_keys: [intro.key, open.key] };
  const endsAt = new Date(Date.now() - 2 * day).toISOString();
  const { error: seedError } = await db.from('deals').insert(
    [
      { ...base, name: testTitle('Status Over'), series_keys: [intro.key, past!.id] },
      { ...base, name: testTitle('Status Ended'), ends_at: endsAt },
      { ...base, name: testTitle('Status Paused'), active: false },
      { ...base, name: testTitle('Status Scheduled'), starts_at: new Date(Date.now() + 5 * day).toISOString() },
      { ...base, name: testTitle('Status Live') },
      { ...base, name: testTitle('Status Mixed'), series_keys: [intro.key, mixedEvent.key] },
    ],
    // Rows that leave a column out get its default, not null.
    { defaultToNull: false }
  );
  expect(seedError).toBeNull();

  await page.goto('/admin');
  await page.locator('.admin-tab-btn[data-tab="deals"]').click();
  const item = (name: string) => page.locator('#deals-list .deal-item', { hasText: testTitle(name) });
  await expect(item('Status Live').locator('.deal-status')).toHaveText('Live');
  await expect(item('Status Paused').locator('.deal-status')).toHaveText('Paused');
  await expect(item('Status Scheduled').locator('.deal-status')).toHaveText('Scheduled');
  await expect(item('Status Ended').locator('.deal-status')).toHaveText('Ended');
  await expect(item('Status Over').locator('.deal-status')).toHaveText("Can't apply anymore");
  await expect(item('Status Over')).toContainText(`${testTitle('Past Workshop')} has passed.`);
  await expect(item('Status Mixed').locator('.deal-status')).toHaveText("Can't apply");
  await expect(item('Status Mixed')).toContainText('mixes classes and events');

  const order = await page.locator('#deals-list .deal-item').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.status));
  const rank = (s: string | undefined) => (s === 'Live' ? 0 : s === 'Paused' || s === 'Scheduled' ? 1 : 2);
  expect(order.map(rank)).toEqual([...order.map(rank)].sort());
  await page.locator('#admin-tab-panel-deals').screenshot({ path: 'tests/e2e/.output/deals-statuses.png' });

  // Editing and saving keeps the same last day, and saving again doesn't move it.
  const endOf = async () => (await db.from('deals').select('ends_at').eq('name', testTitle('Status Ended')).single()).data!.ends_at as string;
  const lastDay = (iso: string) => new Date(Date.parse(iso) - 1).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  for (let i = 0; i < 2; i++) {
    await item('Status Ended').locator('.deal-edit').click();
    await page.locator('#deal-save').click();
    await expect(page.locator('#deals-status')).toHaveText('Saved.');
  }
  const first = await endOf();
  expect(lastDay(first)).toBe(lastDay(endsAt));
  await item('Status Ended').locator('.deal-edit').click();
  await page.locator('#deal-save').click();
  await expect(page.locator('#deals-status')).toHaveText('Saved.');
  expect(await endOf()).toBe(first);
});
