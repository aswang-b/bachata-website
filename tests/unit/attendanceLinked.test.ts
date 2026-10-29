import { describe, expect, it } from 'vitest';
import { settleIncludedClasses, type LinkedRegistrationInfo, type ResolvedAttendanceEntry } from '../../src/lib/attendanceMatching';

// A dancer on "Sensual + Head Movement" (series P) also has the "Sensual II"
// class it includes (series S, $0): both run on the same Sunday.
const checkin = { id: 'c1', first_name: 'A', last_name: 'B', phone: '', email: null, class_title: 'P', event_id: 'p1', created_at: '' };
const entry = (id: string, status: ResolvedAttendanceEntry['status'], date = '2026-11-01T19:00:00Z'): ResolvedAttendanceEntry => ({
  classRegistrationId: id,
  occurrenceEventId: `${id}-occ`,
  occurrenceDate: date,
  firstName: 'A',
  lastName: 'B',
  phone: null,
  email: null,
  classTitle: id,
  seriesMode: 'whole',
  price: 0,
  expansionFailed: false,
  status,
  matchedCheckin: status === 'matched' ? checkin : null,
});
const info = new Map<string, LinkedRegistrationInfo>([
  ['parent', { submissionId: 's', dancerIndex: 0, seriesKey: 'P', includedBy: null }],
  ['included', { submissionId: 's', dancerIndex: 0, seriesKey: 'S', includedBy: 'P' }],
  ['other-dancer', { submissionId: 's', dancerIndex: 1, seriesKey: 'S', includedBy: 'P' }],
]);
const day = (iso: string) => iso.slice(0, 10);

describe('a class and the linked class it includes', () => {
  it('one check-in to the bigger class covers the included one that day', () => {
    const out = settleIncludedClasses([entry('parent', 'matched'), entry('included', 'orphaned')], info, day);
    expect(out.map((e) => e.status)).toEqual(['matched', 'matched']);
    expect(out[1].matchedCheckin).toBe(checkin);
  });

  it('and a check-in to the included class covers the bigger one', () => {
    const out = settleIncludedClasses([entry('parent', 'orphaned'), entry('included', 'matched')], info, day);
    expect(out.map((e) => e.status)).toEqual(['matched', 'matched']);
  });

  it("leaves other days, other dancers and an admin's no-show alone", () => {
    const out = settleIncludedClasses(
      [entry('parent', 'matched'), entry('included', 'orphaned', '2026-11-08T19:00:00Z'), entry('other-dancer', 'orphaned')],
      info,
      day
    );
    expect(out.map((e) => e.status)).toEqual(['matched', 'orphaned', 'orphaned']);
    const noShow = settleIncludedClasses([entry('parent', 'matched'), entry('included', 'no_show')], info, day);
    expect(noShow[1].status).toBe('no_show');
  });
});
