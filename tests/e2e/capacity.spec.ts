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

// Spots used to be counted per name alone, so signing up under the name of
// someone already in a full class took no new spot and got through.
test("a full class refuses someone using a registered dancer's name with their own contact details", async ({ request }) => {
  const namesake = JSON.stringify([{ firstName: 'ZZZTaken', lastName: RUN_ID, role: 'leader', phone: '6085550333', email: '' }]);
  const res = await postForm(request, '/api/submit-intake', { registration_type: 'group', class: full.title, payment_method: 'cash', class_selections: selection(full), dancers: namesake });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain('is full');
  expect(await spotCounts(full.ids[0])).toMatchObject({ taken: 1 });
});

test('two different people with the same name each take a spot', async () => {
  const twins = await seedEvent({ name: 'Namesakes', capacity: 5, dayOffset: 3 });
  await seedSignup(twins, [{ first: 'Same', phone: '6085550401' }]);
  await seedSignup(twins, [{ first: 'Same', phone: '6085550402' }]);
  // The same person signing up again (same details) still counts once.
  await seedSignup(twins, [{ first: 'Same', phone: '(608) 555-0401' }]);
  expect(await spotCounts(twins.ids[0])).toMatchObject({ taken: 2 });
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

test("an admin can change a dancer's Leader/Follower role from the dashboard's edit row", async ({ request, admin }) => {
  const klass = await seedEvent({ name: 'Role Edit', occurrences: 2, capacityByRole: true, leaderCapacity: 3, followerCapacity: 3, capacity: 10, dayOffset: 47 });
  const submissionId = await seedSignup(klass, [{ first: 'RoleSwap', role: 'leader' }]);
  const holderId = `e2e-role-${RUN_ID}`;
  expect((await request.post('/api/admin/acquire-lock', { headers: bearer(admin), data: { resource: 'signups', holderId } })).ok()).toBe(true);
  try {
    const res = await request.post('/api/admin/edit-signup', {
      headers: bearer(admin),
      data: { action: 'update', holderId, submissionId, dancerIndex: 0, firstName: `ZZZRoleSwap`, lastName: RUN_ID, email: '', phone: '5550100', role: 'follower', paymentMethod: 'cash', paid: false, keepClasses: true },
    });
    expect(res.status(), await res.text()).toBe(200);
  } finally {
    await request.post('/api/admin/release-lock', { headers: bearer(admin), data: { resource: 'signups', holderId } });
  }
  const { data } = await db.from('intake_submissions').select('dancers').eq('id', submissionId).single();
  expect((data!.dancers as { role: string }[])[0].role).toBe('follower');
  for (const occ of klass.ids) expect(await spotCounts(occ)).toMatchObject({ leaders_taken: 0, followers_taken: 1 });
});
