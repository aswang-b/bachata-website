import { afterEach, describe, expect, it } from 'vitest';
import { buildClassSeriesList } from '../../src/lib/classSeries';
import { setServerTimeZone } from '../../src/lib/siteTime';
import { entryFilterValue, eventFilterOptions, eventNoteLabel, matchesEventFilter, type EventFilterSignup } from '../../src/lib/eventRegistrationFilter';

// The Event Registration tab's filter goes by the event's series key: two
// socials with one name on different dates are two options (they were merged
// by title). The site is in Central here (the tests' default).
afterEach(() => setServerTimeZone('America/Chicago'));

const event = (id: string, title: string, start: string, recurring: string | null = null) => ({
  id,
  title,
  start_time: start,
  end_time: new Date(Date.parse(start) + 3 * 3600_000).toISOString(),
  google_recurring_event_id: recurring,
});

// Fri Nov 20 and Fri Dec 4, 2026, 8 PM Central (UTC-6 in winter).
const nov = event('e-nov', 'Besito Bachata Social', '2026-11-21T02:00:00Z');
const dec = event('e-dec', 'Besito Bachata Social', '2026-12-05T02:00:00Z');
const series = buildClassSeriesList([dec, nov]);

const signup = (createdAt: string, ...entries: { classTitle: string; seriesKey?: string | null }[]): EventFilterSignup => ({ createdAt, classRegistrations: entries });
const novGuest = signup('2026-10-01T00:00:00Z', { classTitle: nov.title, seriesKey: 'e-nov' });
const decGuest = signup('2026-10-02T00:00:00Z', { classTitle: dec.title, seriesKey: 'e-dec' });

describe('the event filter options', () => {
  it('lists two same-titled events on different dates as two dated options, soonest first', () => {
    expect(eventFilterOptions([decGuest, novGuest], series)).toEqual([
      { value: 'e-nov', label: 'Besito Bachata Social · Fri, Nov 20' },
      { value: 'e-dec', label: 'Besito Bachata Social · Fri, Dec 4' },
    ]);
  });

  it("dates an event in its own zone, not the site's or the machine's", () => {
    // 11:30 PM Mountain on Nov 20 is already Nov 21 in Central and Tokyo's Nov 21.
    const late = buildClassSeriesList([{ ...event('e-late', 'Late Social', '2026-11-21T06:30:00Z'), time_zone: 'America/Denver' }]);
    expect(eventFilterOptions([signup('2026-10-01T00:00:00Z', { classTitle: 'Late Social', seriesKey: 'e-late' })], late)[0].label).toBe('Late Social · Fri, Nov 20');
  });

  it('keeps a recurring series as one option with its date range', () => {
    const weekly = buildClassSeriesList([event('w1', 'Practica', '2026-11-21T02:00:00Z', 'rec'), event('w2', 'Practica', '2026-11-28T02:00:00Z', 'rec'), event('w3', 'Practica', '2026-12-05T02:00:00Z', 'rec')]);
    const rows = [signup('2026-10-01T00:00:00Z', { classTitle: 'Practica', seriesKey: 'rec' }), signup('2026-10-02T00:00:00Z', { classTitle: 'Practica', seriesKey: 'rec' })];
    expect(eventFilterOptions(rows, weekly)).toEqual([{ value: 'rec', label: 'Practica · Nov 20 – Dec 4' }]);
  });

  it('breaks a date tie by title', () => {
    const two = buildClassSeriesList([event('b', 'B Social', '2026-11-21T02:00:00Z'), event('a', 'A Social', '2026-11-21T02:00:00Z')]);
    const rows = [signup('2026-10-01T00:00:00Z', { classTitle: 'B Social', seriesKey: 'b' }, { classTitle: 'A Social', seriesKey: 'a' })];
    expect(eventFilterOptions(rows, two).map((o) => o.value)).toEqual(['a', 'b']);
  });

  it('offers an event others count toward even with no sign-ups of its own, and not unrelated events', () => {
    expect(eventFilterOptions([], series, ['e-dec']).map((o) => o.value)).toEqual(['e-dec']);
    expect(eventFilterOptions([], series, ['gone'])).toEqual([]);
  });

  it('gives registrations with no series key a title option, after the dated ones, never merged with a dated event', () => {
    const old = signup('2020-01-01T00:00:00Z', { classTitle: nov.title, seriesKey: null });
    const options = eventFilterOptions([old, novGuest], series);
    expect(options).toEqual([
      { value: 'e-nov', label: 'Besito Bachata Social · Fri, Nov 20' },
      { value: `title:${nov.title}`, label: nov.title },
    ]);
    expect(entryFilterValue(old.classRegistrations[0])).toBe(`title:${nov.title}`);
  });

  it('gives an event that is no longer listed its own option from what its sign-ups carry, one per series key', () => {
    const gone1 = signup('2026-03-05T12:00:00Z', { classTitle: 'Besito Bachata Social', seriesKey: 'deleted-1' });
    const gone2 = signup('2026-04-09T12:00:00Z', { classTitle: 'Besito Bachata Social', seriesKey: 'deleted-2' });
    const gone3 = signup('2026-05-01T12:00:00Z', { classTitle: 'Winter Gala', seriesKey: 'deleted-3' });
    const options = eventFilterOptions([gone2, gone3, gone1, novGuest], series);
    expect(options.map((o) => o.value)).toEqual(['e-nov', 'deleted-1', 'deleted-2', 'deleted-3']);
    // Alone under its title it is plain; two of one title are told apart by their first sign-up.
    expect(options[3].label).toBe('Winter Gala (no longer listed)');
    expect(options[1].label).toBe('Besito Bachata Social (no longer listed) · first sign-up Mar 5, 2026');
    expect(options[2].label).toBe('Besito Bachata Social (no longer listed) · first sign-up Apr 9, 2026');
  });

  it('labels a renamed event by its current title', () => {
    const renamed = buildClassSeriesList([{ ...nov, title: 'Besito Renamed' }]);
    expect(eventFilterOptions([novGuest], renamed)[0].label).toBe('Besito Renamed · Fri, Nov 20');
  });
});

describe('matching registrations by series key', () => {
  it('separates the dancers of two same-titled events', () => {
    const all = [novGuest, decGuest];
    expect(all.filter((s) => matchesEventFilter(s.classRegistrations, 'e-nov'))).toEqual([novGuest]);
    expect(all.filter((s) => matchesEventFilter(s.classRegistrations, 'e-dec'))).toEqual([decGuest]);
    expect(all.filter((s) => matchesEventFilter(s.classRegistrations, ''))).toEqual(all);
  });

  it('finds a dancer registered for several events under any of them, and title-only rows by title', () => {
    const both = signup('2026-10-03T00:00:00Z', { classTitle: nov.title, seriesKey: 'e-nov' }, { classTitle: dec.title, seriesKey: 'e-dec' });
    expect(matchesEventFilter(both.classRegistrations, 'e-dec')).toBe(true);
    expect(matchesEventFilter(both.classRegistrations, 'e-other')).toBe(false);
    expect(matchesEventFilter([{ classTitle: 'Old', seriesKey: null }], 'title:Old')).toBe(true);
    // A title option never catches a row that has a key.
    expect(matchesEventFilter(novGuest.classRegistrations, `title:${nov.title}`)).toBe(false);
  });
});

describe('the "+ N from" note', () => {
  it('names the title alone, or with its date when another event shares it', () => {
    const solo = buildClassSeriesList([event('s', 'Gala', '2026-11-21T02:00:00Z')]);
    expect(eventNoteLabel('s', 'Gala', solo)).toBe('Gala');
    expect(eventNoteLabel('e-dec', 'Besito Bachata Social', series)).toBe('Besito Bachata Social · Fri, Dec 4');
    expect(eventNoteLabel('unknown', 'Fallback', series)).toBe('Fallback');
  });
});
