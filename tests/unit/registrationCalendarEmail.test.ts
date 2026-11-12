import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));
vi.mock('../../src/lib/faqs', () => ({ listFaqs: async () => [] }));
vi.mock('../../src/lib/communityGuidelines', () => ({ getCommunityGuidelines: async () => '', guidelineSections: () => [] }));
vi.mock('../../src/lib/siteConfig', () => ({ loadWhatsappUrl: async () => null }));
vi.mock('../../src/lib/testMode', () => ({ publicVisibilities: () => ['public'] }));

import { buildRegistrationConfirmation } from '../../src/lib/registrationConfirmation';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const future = (days: number) => new Date(Date.now() + days * 864e5).toISOString();
const salsa = (n: number, days: number) => ({ id: ID(n), title: 'Salsa', visibility: 'public', google_recurring_event_id: 'ser', start_time: future(days), end_time: future(days), time_zone: 'America/Chicago' });

beforeEach(() => {
  db.current = new FakeSupabase();
  db.current.seed('intake_submissions', [
    { id: 'sub', registration_type: 'group', created_at: '2027-01-01T00:00:00Z', first_name: 'Dana', last_name: 'Q', email: 'dana@example.com', phone: '555-123-4567', instagram: null, whatsapp: null, class: 'Salsa', comments: null, dancers: null, payment_method: 'cash', deleted_at: null },
  ]);
  db.current.seed('class_registrations', [
    { id: 'r1', submission_id: 'sub', first_name: 'Dana', last_name: 'Q', email: 'dana@example.com', phone: '555-123-4567', class_title: 'Salsa', class_label: 'Salsa', series_key: 'ser', series_mode: 'whole', price: 50, occurrence_event_id: null },
  ]);
});

describe("the dancer's confirmation email", () => {
  it('has an Add to calendar link carrying only the upcoming class date ids', async () => {
    db.current.seed('events', [salsa(1, 10), salsa(2, 17), salsa(3, -20)]);
    const conf = await buildRegistrationConfirmation('sub');
    const href = conf!.html.match(/href="(https:\/\/dancewithb\.fun\/calendar\/ics\?[^"]*)"[^>]*>Add to calendar</)?.[1];
    expect(href).toBe(`https://dancewithb.fun/calendar/ics?e=${ID(1)},${ID(2)}`);
    expect(href).not.toMatch(/dana|555|sub|50/i);
  });

  it('has no link when no class date is upcoming', async () => {
    db.current.seed('events', [salsa(3, -20)]);
    const conf = await buildRegistrationConfirmation('sub');
    expect(conf!.html).not.toContain('Add to calendar');
  });
});
