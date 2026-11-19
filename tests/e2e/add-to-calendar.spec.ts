import { test, expect } from './support/fixtures';
import { db, seedEvent, sweepTestData, type Seeded } from './support/db';
import { RUN_ID } from './support/env';
import { emailsAbout, recipients } from './support/emails';
import { confirmationId, fillDancer, payCash, selectSeries, submitRegistration } from './support/forms';

// The "Add to calendar" link on the confirmation page and in the confirmation
// email: /calendar/ics with the ids of the class dates the sign-up covers.
test.afterAll(sweepTestData);

let series: Seeded;

test.beforeAll(async () => {
  series = await seedEvent({ name: 'Calendar Series', occurrences: 2, priceWhole: 50, priceDropIn: 15, timeZone: 'America/Denver', city: 'ZZZ Faraway', state: 'NM', dayOffset: 4 });
});

const iso = (s: string) => new Date(s).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

test('a confirmation page offers the series dates as a calendar file, and so does the email', async ({ page }) => {
  const email = `zzz-e2e-${RUN_ID.toLowerCase()}-cal@example.com`;
  await page.goto(`/register?series=${series.key}`);
  await selectSeries(page, series.key);
  await fillDancer(page, 0, { first: 'Cal', role: 'leader', email });
  await payCash(page);
  await submitRegistration(page);
  await page.waitForURL(/\/register\/confirmation\?id=/);
  const submissionId = confirmationId(page.url())!;

  const link = page.getByRole('link', { name: 'Add to calendar' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('download', /\.ics$/);
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const href = (await link.getAttribute('href'))!;
  // Only the ids of the two upcoming dates: nothing about the dancer.
  expect(href).toBe(`/calendar/ics?e=${series.ids.join(',')}`);
  expect(href).not.toContain(submissionId);

  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('text/calendar; charset=utf-8');
  expect(res.headers()['content-disposition']).toBe('attachment; filename="dance-with-b.ics"');
  const body = await res.text();
  expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  for (const secret of ['ZZZCal', email, '6085550100', submissionId]) expect(body).not.toContain(secret);
  expect(body).toContain(`SUMMARY:${series.title}\r\n`);
  expect(body).toContain('LOCATION:ZZZ Test Studio\\, ZZZ Faraway\r\n');
  // Each date links to the series' own registration page, not the calendar.
  const urls = body.replace(/\r\n /g, '').split('\r\n').filter((l) => l.startsWith('URL:'));
  expect(urls).toEqual([`URL:https://dancewithb.fun/register?series=${encodeURIComponent(series.key)}`, `URL:https://dancewithb.fun/register?series=${encodeURIComponent(series.key)}`]);

  const { data: rows } = await db.from('events').select('id, start_time, end_time').in('id', series.ids).order('start_time');
  expect(rows).toHaveLength(2);
  for (const r of rows!) {
    expect(body).toContain(`UID:${r.id}@dancewithb.fun\r\n`);
    expect(body).toContain(`DTSTART:${iso(r.start_time)}\r\n`);
    expect(body).toContain(`DTEND:${iso(r.end_time)}\r\n`);
  }
  // Every line is at most 75 bytes and ends in CRLF.
  expect(body.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  expect(body.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);

  // The dancer's confirmation email carries the same link, absolute.
  const sent = emailsAbout('ZZZCal').filter((e) => e.html.includes(RUN_ID) && recipients(e).includes(email));
  expect(sent).toHaveLength(1);
  const emailHref = sent[0].html.match(/href="([^"]*\/calendar\/ics\?[^"]*)"[^>]*>Add to calendar</)?.[1];
  expect(emailHref).toBe(`https://dancewithb.fun/calendar/ics?e=${series.ids.join(',')}`);
});

test('the file route refuses bad links and unknown classes', async ({ request }) => {
  expect((await request.get('/calendar/ics')).status()).toBe(400);
  expect((await request.get('/calendar/ics?e=not-an-id')).status()).toBe(400);
  expect((await request.get('/calendar/ics?e=00000000-0000-4000-8000-00000000dead')).status()).toBe(404);
});
