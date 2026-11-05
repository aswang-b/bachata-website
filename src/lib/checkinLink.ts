import { supabase } from './supabase';
import { siteFormatter } from './siteTime';
import { createCheckinRegisterToken } from './checkinToken';

// The check-in address for one or more classes, shared by the plain check-in
// QR (generate-checkin-qr.ts) and the door sign's short link (qr-studio.ts).
// One class keeps the original per-class link; two or more link to the general
// check-in page limited to those events, each class's signed register token
// carried as `<eventId>.<token>`.

// A QR can cover several classes at once; a sanity cap well above any real schedule.
export const MAX_EVENTS_PER_QR = 12;

export interface CheckinEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  price_drop_in: number | null;
  registration_closed: boolean | null;
}

export interface CheckinLink {
  url: string;
  events: CheckinEvent[];
  title: string;
  scheduleLabel: string;
  createRegistration: boolean;
}

export class CheckinLinkError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

// The ids in a request body: `eventIds`, or the older single `eventId`.
export function eventIdsFrom(body: unknown): string[] {
  const b = body as { eventIds?: unknown; eventId?: unknown } | null;
  const raw: unknown[] = Array.isArray(b?.eventIds) ? b.eventIds : b?.eventId ? [b.eventId] : [];
  return [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

export function checkinUrl(origin: string, eventIds: string[], tokens: string[]): string {
  if (eventIds.length === 1) return `${origin}/check-in/${eventIds[0]}${tokens[0] ? `?register=${tokens[0]}` : ''}`;
  const register = tokens.length ? `&register=${eventIds.map((id, i) => `${id}.${tokens[i]}`).join(',')}` : '';
  return `${origin}/check-in?events=${eventIds.join(',')}${register}`;
}

const dateFormatter = { format: (d: Date) => siteFormatter({ weekday: 'long', month: 'long', day: 'numeric' }).format(d) };
const timeFormatter = { format: (d: Date) => siteFormatter({ hour: 'numeric', minute: '2-digit' }).format(d) };
const scheduleOf = (e: CheckinEvent) =>
  `${dateFormatter.format(new Date(e.start_time))}, ${timeFormatter.format(new Date(e.start_time))}–${timeFormatter.format(new Date(e.end_time))}`;

// Throws CheckinLinkError (with the HTTP status to answer) for a bad request.
export async function buildCheckinLink(origin: string, eventIds: string[], createRegistration: boolean): Promise<CheckinLink> {
  if (eventIds.length === 0) throw new CheckinLinkError('Pick at least one class.', 400);
  if (eventIds.length > MAX_EVENTS_PER_QR) throw new CheckinLinkError(`Pick at most ${MAX_EVENTS_PER_QR} classes for one QR code.`, 400);

  const { data: found, error } = await supabase
    .from('events')
    .select('id, title, start_time, end_time, price_drop_in, registration_closed')
    .in('id', eventIds);
  if (error || !found || found.length !== eventIds.length) throw new CheckinLinkError('One of those classes could not be found.', 404);
  // Keep the order the admin picked them in.
  const events = eventIds.map((id) => (found as CheckinEvent[]).find((e) => e.id === id)!);

  // Registering attendees needs a drop-in price and open registration (the check-in re-checks this too).
  if (createRegistration && events.some((e) => e.price_drop_in == null || e.registration_closed)) {
    throw new CheckinLinkError('Registering attendees needs a drop-in price and registration to be open for every selected class.', 400);
  }
  const tokens = createRegistration ? events.map((e) => createCheckinRegisterToken(e.id)) : [];
  if (tokens.some((t) => !t)) throw new CheckinLinkError('Registering attendees is unavailable: the server has no signing key.', 500);

  return {
    url: checkinUrl(origin, eventIds, tokens as string[]),
    events,
    title: events.length === 1 ? events[0].title : `${events.length} classes — dancers choose`,
    scheduleLabel: events.length === 1 ? scheduleOf(events[0]) : events.map((e) => `${e.title} (${scheduleOf(e)})`).join(' · '),
    createRegistration,
  };
}
