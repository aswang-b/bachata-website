import { describe, expect, it } from 'vitest';
import type { ClassSeriesEntry } from '../../src/lib/classSeries';
import { expandRegistrationsToEntries, type AttendanceRegistrationRow } from '../../src/lib/attendanceMatching';

// Two different series that happen to share one title and run at the same time.
const series = (key: string, timeZone: string, nextStartTime: string, occurrences: Array<[string, string]>): ClassSeriesEntry =>
  ({
    key,
    title: 'Besito Social',
    timeZone,
    nextStartTime,
    occurrences: occurrences.map(([id, startTime]) => ({ id, label: id, startTime })),
  }) as unknown as ClassSeriesEntry;

const first = series('series-a', 'America/Denver', '2027-06-01T01:00:00Z', [['a1', '2027-06-01T01:00:00Z'], ['a2', '2027-06-08T01:00:00Z']]);
const second = series('series-b', 'America/Chicago', '2027-07-01T01:00:00Z', [['b1', '2027-07-01T01:00:00Z'], ['b2', '2027-07-08T01:00:00Z'], ['b3', '2027-07-15T01:00:00Z']]);
const list = [first, second];

const reg = (overrides: Partial<AttendanceRegistrationRow>): AttendanceRegistrationRow => ({
  id: 'r1',
  first_name: 'A',
  last_name: 'B',
  email: null,
  phone: null,
  class_title: 'Besito Social',
  series_key: null,
  series_mode: 'whole',
  price: 20,
  occurrence_event_id: null,
  // Closer to the first series' start than the second's.
  created_at: '2027-05-30T00:00:00Z',
  ...overrides,
});

describe('registration series matching with a shared title', () => {
  it("expands a Whole-Series sign-up into its own series' dates by series_key", () => {
    const entries = expandRegistrationsToEntries([reg({ series_key: 'series-b' })], list);
    expect(entries.map((e) => e.occurrenceEventId)).toEqual(['b1', 'b2', 'b3']);
    expect(entries.every((e) => e.seriesKey === 'series-b' && e.occurrenceTimeZone === 'America/Chicago')).toBe(true);
  });

  it("resolves a Drop-In without series_key to the chosen occurrence's series, zone and date", () => {
    const [entry] = expandRegistrationsToEntries([reg({ series_mode: 'dropin', occurrence_event_id: 'b2' })], list);
    expect(entry.seriesKey).toBe('series-b');
    expect(entry.occurrenceTimeZone).toBe('America/Chicago');
    expect(entry.occurrenceDate).toBe('2027-07-08T01:00:00Z');
  });

  it('keeps the title plus closest-start fallback for legacy rows', () => {
    const entries = expandRegistrationsToEntries([reg({})], list);
    expect(entries.map((e) => e.occurrenceEventId)).toEqual(['a1', 'a2']);
    const [dropIn] = expandRegistrationsToEntries([reg({ series_mode: 'dropin', created_at: '2027-06-28T00:00:00Z' })], list);
    expect(dropIn.seriesKey).toBe('series-b');
    expect(dropIn.occurrenceDate).toBe('2027-07-15T01:00:00Z');
  });

  it('falls back to the title when the recorded series_key is no longer listed', () => {
    const entries = expandRegistrationsToEntries([reg({ series_key: 'gone' })], list);
    expect(entries.map((e) => e.occurrenceEventId)).toEqual(['a1', 'a2']);
    expect(entries[0].seriesKey).toBe('gone');
  });
});
