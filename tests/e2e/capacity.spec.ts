import { test, expect, postForm } from './support/fixtures';
import { db, seedEvent, seedSignup, spotCounts, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { fillDancer, payCash, selectSeries, submitRegistration } from './support/forms';
import { bearer } from './support/admin';

let full: Seeded;
let roles: Seeded;
let hidden: Seeded;
let roleSubmission: string;

test.beforeAll(async () => {
  full = await seedEvent({ name: 'Full Class', capacity: 1, showCapacity: true });
  await seedSignup(full, [{ first: 'Taken', role: 'leader' }]);

  roles = await seedEvent({ name: 'Role Caps', occurrences: 2, capacityByRole: true, leaderCapacity: 1, followerCapacity: 2, capacity: 50, showCapacity: true, dayOffset: 1 });
  roleSubmission = await seedSignup(roles, [{ first: 'Leader', role: 'leader' }]);

  hidden = await seedEvent({ name: 'Hidden Caps', capacityByRole: true, leaderCapacity: 1, followerCapacity: 5, showCapacity: false, dayOffset: 2 });
  await seedSignup(hidden, [{ first: 'HiddenLead', role: 'leader' }]);
});

const selection = (s: Seeded, mode: 'whole' | null = 'whole') => JSON.stringify([{ key: s.key, title: s.title, label: '', mode }]);
const people = (role: string, n: number) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ firstName: `ZZZCap${i}`, lastName: RUN_ID, role, phone: `60855502${i}0`, email: '' })));

test('a full class shows "Full", cannot be picked, and the server refuses more sign-ups', async ({ page, request }) => {
  await page.goto('/register');
  const item = page.locator(`.series-item[data-key="${full.key}"]`);
  await expect(item).toContainText('Full');
  // With nothing to expand it isn't a control at all; clicked anyway to prove it stays unpicked.
  await expect(item.locator('.series-toggle-btn')).not.toHaveAttribute('role', /.*/);
  await item.locator('.series-toggle-btn').click({ force: true });
  await expect(item).not.toHaveAttribute('data-selected', 'true');

  const res = await postForm(request, '/api/submit-intake', { registration_type: 'group', class: full.title, payment_method: 'cash', class_selections: selection(full), dancers: people('leader', 1) });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain('is full');
});

test('separate Leader/Follower caps: counted per role, shown per role, enforced per role', async ({ page, request }) => {
  // One Whole Series leader counts in every class of the series.
  for (const occ of roles.ids) expect(await spotCounts(occ)).toMatchObject({ leaders_taken: 1, followers_taken: 0 });

  await page.goto('/register');
  const item = page.locator(`.series-item[data-key="${roles.key}"]`);
  await expect(item).toContainText('Leaders full · 2 follower spots left');

  // The form stops a leader before submitting...
  await selectSeries(page, roles.key);
  await fillDancer(page, 0, { first: 'TryLead', role: 'leader' });
  await payCash(page);
  await submitRegistration(page);
  await expect(page.locator('#role-full-error')).toContainText('is full for leaders');
  await expect(page).toHaveURL(/\/register/);

  // ...and the server turns away a full role or too many of an open one.
  const lead = await postForm(request, '/api/submit-intake', { registration_type: 'group', class: roles.title, payment_method: 'cash', class_selections: selection(roles), dancers: people('leader', 1) });
  expect(lead.status()).toBe(400);
  expect(await lead.text()).toContain('is full for leaders');
  const follows = await postForm(request, '/api/submit-intake', { registration_type: 'group', class: roles.title, payment_method: 'cash', class_selections: selection(roles), dancers: people('follower', 3) });
  expect(follows.status()).toBe(400);
  expect(await follows.text()).toContain('only has 2 follower spots left');
});

test("editing a dancer's role recounts the spots", async () => {
  const { data } = await db.from('intake_submissions').select('dancers').eq('id', roleSubmission).single();
  const dancers = data!.dancers as { role: string }[];
  await db.from('intake_submissions').update({ dancers: dancers.map((d) => ({ ...d, role: 'follower' })) }).eq('id', roleSubmission);
  expect(await spotCounts(roles.ids[0])).toMatchObject({ leaders_taken: 0, followers_taken: 1 });
  await db.from('intake_submissions').update({ dancers }).eq('id', roleSubmission);
  expect(await spotCounts(roles.ids[0])).toMatchObject({ leaders_taken: 1, followers_taken: 0 });
});

test('with spots hidden, the public only learns that a role is full; admins see the counts', async ({ page, request, admin }) => {
  await page.goto('/register');
  const item = page.locator(`.series-item[data-key="${hidden.key}"]`);
  await expect(item).toContainText('Leaders full');
  await expect(item).not.toContainText('follower spot');

  const series = await (await request.get('/api/admin/series-spots', { headers: bearer(admin) })).json();
  expect(series.series[hidden.key]).toMatchObject({ label: 'Leaders full · 5 follower spots left', shown: false, full: false });
  const all = await (await request.get('/api/admin/all-events', { headers: bearer(admin) })).json();
  const occ = all.events.find((e: { id: string }) => e.id === hidden.ids[0]);
  expect(occ).toMatchObject({ spots_label: 'Leaders full · 5 follower spots left', spots_admin_only: true });
});
