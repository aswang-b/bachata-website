import { afterEach, describe, expect, it } from 'vitest';
import { buildClassSeriesList } from '../../src/lib/classSeries';
import { setServerTimeZone } from '../../src/lib/siteTime';
import {
  classFilterOptions,
  classFilterRows,
  rowMatchesClassPick,
  signupMatchesClassPick,
  type ClassFilterRow,
  type ClassFilterSignupEntry,
} from '../../src/lib/classFilterOptions';

// The Sign-Ups, Check-Ins and Attendance tabs' "Filter by class" goes by the
// class's series key, like the Event Registration tab's filter: it matched by
// title and by part of a title, so two same-named classes ran together and a
// class whose title contained another's was picked up by it. The site is in
// Central here (the tests' default); also run under TZ=Asia/Tokyo.
afterEach(() => setServerTimeZone('America/Chicago'));

const klass = (id: string, title: string, start: string, recurring: string | null = null, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  start_time: start,
  end_time: new Date(Date.parse(start) + 3600_000).toISOString(),
  google_recurring_event_id: recurring,
  ...extra,
});

// Tue Nov 3 and Tue Dec 1, 2026, 7 PM Central; and a class whose title contains theirs.
const novBasics = klass('c-nov', 'Bachata Basics', '2026-11-04T01:00:00Z');
const decBasics = klass('c-dec', 'Bachata Basics', '2026-12-02T01:00:00Z');
const advanced = klass('c-adv', 'Bachata Basics Advanced', '2026-11-11T01:00:00Z');
const series = buildClassSeriesList([decBasics, advanced, novBasics]);

const row = (classTitle: string, seriesKey: string | null = null, createdAt = '2026-10-01T00:00:00Z'): ClassFilterRow => ({ classTitle, seriesKey, createdAt });

describe('the class filter entries', () => {
  it('lists two same-titled classes as two dated entries, soonest first, and the class that contains their title as its own', () => {
    expect(classFilterOptions([], series)).toEqual([
      { value: 'c-nov', label: 'Bachata Basics · Tue, Nov 3' },
      { value: 'c-adv', label: 'Bachata Basics Advanced · Tue, Nov 10' },
      { value: 'c-dec', label: 'Bachata Basics · Tue, Dec 1' },
    ]);
  });

  it("lists every class, with or without rows, and dates each in its own zone, not the site's or the machine's", () => {
    // 11:30 PM Mountain on Nov 3 is already Nov 4 in Central and in Tokyo.
    const late = buildClassSeriesList([klass('c-late', 'Late Class', '2026-11-04T06:30:00Z', null, { time_zone: 'America/Denver' })]);
    expect(classFilterOptions([], late)).toEqual([{ value: 'c-late', label: 'Late Class · Tue, Nov 3' }]);
  });

  it('keeps a recurring series as one entry with its whole date range', () => {
    const weekly = buildClassSeriesList([
      klass('w1', 'Salsa', '2026-11-04T01:00:00Z', 'rec'),
      klass('w2', 'Salsa', '2026-11-11T01:00:00Z', 'rec'),
      klass('w3', 'Salsa', '2026-11-18T01:00:00Z', 'rec'),
    ]);
    expect(classFilterOptions([], weekly)).toEqual([{ value: 'rec', label: 'Salsa · Nov 3 – Nov 17' }]);
  });

  it('gives rows with no series key an entry by their exact title, after the dated ones, one per title', () => {
    const old = [row('Bachata Basics'), row('Bachata Basics'), row('Old Salsa')];
    const options = classFilterOptions(old, series);
    expect(options.slice(0, 3).map((o) => o.value)).toEqual(['c-nov', 'c-adv', 'c-dec']);
    expect(options.slice(3)).toEqual([
      { value: 'title:Bachata Basics', label: 'Bachata Basics' },
      { value: 'title:Old Salsa', label: 'Old Salsa' },
    ]);
  });

  it('gives a deleted class its own entry rather than merging it by title', () => {
    const options = classFilterOptions([row('Bachata Basics', 'deleted-key')], series);
    expect(options[options.length - 1]).toEqual({ value: 'deleted-key', label: 'Bachata Basics (no longer listed)' });
  });

  it('builds its rows from every tab, without a date for attendance entries', () => {
    const rows = classFilterRows({
      signups: [{ createdAt: 's', classRegistrations: [{ classTitle: 'A', seriesKey: 'a' }, { classTitle: 'B', seriesKey: null }] }],
      checkins: [{ createdAt: 'c', classTitle: 'C', seriesKey: 'c' }],
      attendance: [{ classTitle: 'D', seriesKey: 'd' }],
      orphanedCheckins: [{ created_at: 'o', class_title: 'E', seriesKey: 'e' }],
    });
    expect(rows).toEqual([
      { classTitle: 'A', seriesKey: 'a', createdAt: 's' },
      { classTitle: 'B', seriesKey: null, createdAt: 's' },
      { classTitle: 'C', seriesKey: 'c', createdAt: 'c' },
      { classTitle: 'D', seriesKey: 'd' },
      { classTitle: 'E', seriesKey: 'e', createdAt: 'o' },
    ]);
  });
});

describe('matching a check-in or attendance row', () => {
  it('goes by the series key: same-named classes are not merged', () => {
    const nov = row('Bachata Basics', 'c-nov');
    const dec = row('Bachata Basics', 'c-dec');
    expect(rowMatchesClassPick(nov, 'c-nov', { value: 'c-nov', occurrenceId: '' })).toBe(true);
    expect(rowMatchesClassPick(dec, 'c-dec', { value: 'c-nov', occurrenceId: '' })).toBe(false);
  });

  it("never by part of a title: a class whose title contains another's is not matched by it", () => {
    const adv = row('Bachata Basics Advanced', 'c-adv');
    expect(rowMatchesClassPick(adv, 'c-adv', { value: 'c-nov', occurrenceId: '' })).toBe(false);
    expect(rowMatchesClassPick(adv, 'c-adv', { value: 'title:Bachata Basics', occurrenceId: '' })).toBe(false);
    // Nor does a title-only row match a series key, or the other way round.
    expect(rowMatchesClassPick(row('Bachata Basics'), null, { value: 'c-nov', occurrenceId: '' })).toBe(false);
    expect(rowMatchesClassPick(row('Bachata Basics'), null, { value: 'title:Bachata Basics', occurrenceId: '' })).toBe(true);
    expect(rowMatchesClassPick(row('Bachata Basics Advanced'), null, { value: 'title:Bachata Basics', occurrenceId: '' })).toBe(false);
  });

  it('with a date picked, passes only a row for that class date', () => {
    const r = row('Salsa', 'rec');
    expect(rowMatchesClassPick(r, 'w2', { value: 'rec', occurrenceId: 'w2' })).toBe(true);
    expect(rowMatchesClassPick(r, 'w1', { value: 'rec', occurrenceId: 'w2' })).toBe(false);
    expect(rowMatchesClassPick(r, null, { value: 'rec', occurrenceId: 'w2' })).toBe(false);
  });

  it('a row with no class at all matches no entry', () => {
    expect(rowMatchesClassPick(row('', null), null, { value: 'title:', occurrenceId: '' })).toBe(true); // never offered, so never picked
    expect(rowMatchesClassPick(row('', null), null, { value: 'c-nov', occurrenceId: '' })).toBe(false);
  });
});

describe('matching a sign-up', () => {
  const entry = (seriesKey: string | null, o: Partial<ClassFilterSignupEntry> = {}): ClassFilterSignupEntry => ({
    classTitle: 'Bachata Basics',
    seriesKey,
    seriesMode: 'whole',
    occurrenceEventId: null,
    ...o,
  });

  it('goes by the series key, and by any of the dancer\'s classes', () => {
    const both = [entry('c-nov'), entry('c-adv', { classTitle: 'Bachata Basics Advanced' })];
    expect(signupMatchesClassPick(both, { value: 'c-nov', occurrenceId: '' })).toBe(true);
    expect(signupMatchesClassPick(both, { value: 'c-adv', occurrenceId: '' })).toBe(true);
    expect(signupMatchesClassPick(both, { value: 'c-dec', occurrenceId: '' })).toBe(false);
    // The advanced class alone never shows under the class its title contains.
    expect(signupMatchesClassPick([entry('c-adv', { classTitle: 'Bachata Basics Advanced' })], { value: 'c-nov', occurrenceId: '' })).toBe(false);
  });

  it('with a date picked: a Whole Series covers every date, a Drop-In only its own', () => {
    const whole = [entry('rec')];
    const dropIn = [entry('rec', { seriesMode: 'dropin', occurrenceEventId: 'w2' })];
    const undated = [entry('rec', { seriesMode: 'dropin' })];
    expect(signupMatchesClassPick(whole, { value: 'rec', occurrenceId: 'w3' })).toBe(true);
    expect(signupMatchesClassPick(dropIn, { value: 'rec', occurrenceId: 'w2' })).toBe(true);
    expect(signupMatchesClassPick(dropIn, { value: 'rec', occurrenceId: 'w3' })).toBe(false);
    expect(signupMatchesClassPick(undated, { value: 'rec', occurrenceId: 'w2' })).toBe(false);
    // The date has to be for the class picked, not another of the dancer's.
    expect(signupMatchesClassPick([entry('rec', { seriesMode: 'dropin', occurrenceEventId: 'w2' }), entry('other')], { value: 'other', occurrenceId: 'w2' })).toBe(true);
    expect(signupMatchesClassPick([entry('rec', { seriesMode: 'dropin', occurrenceEventId: 'w2' }), entry('other', { seriesMode: 'dropin' })], { value: 'other', occurrenceId: 'w2' })).toBe(false);
  });

  it('a sign-up with no series key is found by its exact title only', () => {
    const old = [entry(null)];
    expect(signupMatchesClassPick(old, { value: 'title:Bachata Basics', occurrenceId: '' })).toBe(true);
    expect(signupMatchesClassPick(old, { value: 'title:Bachata', occurrenceId: '' })).toBe(false);
    expect(signupMatchesClassPick(old, { value: 'c-nov', occurrenceId: '' })).toBe(false);
  });
});
