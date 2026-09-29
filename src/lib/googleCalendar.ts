import { env } from './env';
import { supabase } from './supabase';

// Google requires an explicit timeZone alongside dateTime for recurring
// events (it won't infer one from a bare "Z" UTC offset the way it does for
// one-off events) — omitting it fails with "Missing time zone definition for
// start time." Every event on this site is scheduled in this timezone.
const TIME_ZONE = 'America/Chicago';

const GOOGLE_CLIENT_ID = env('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = env('GOOGLE_CLIENT_SECRET');
const CALENDAR_ID_PUBLIC = env('GOOGLE_CALENDAR_ID_PUBLIC');
const CALENDAR_ID_PRIVATE = env('GOOGLE_CALENDAR_ID_PRIVATE');

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !CALENDAR_ID_PUBLIC || !CALENDAR_ID_PRIVATE) {
  throw new Error(
    'Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALENDAR_ID_PUBLIC, or GOOGLE_CALENDAR_ID_PRIVATE.'
  );
}

export type EventVisibility = 'public' | 'private';

const CALENDAR_IDS: Record<EventVisibility, string> = {
  public: CALENDAR_ID_PUBLIC,
  private: CALENDAR_ID_PRIVATE,
};

function calendarApiBase(visibility: EventVisibility): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_IDS[visibility])}/events`;
}

export interface GoogleCalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
  colorId?: string;
  recurringEventId?: string;
}

// Maps our site's color names to Google Calendar's fixed event colorId
// palette (https://developers.google.com/calendar/api/v3/reference/colors).
// 'accent' and 'yellow' are kept here (though no longer offered in the admin
// picker) so existing data of those colors keeps round-tripping correctly.
const SITE_TO_GOOGLE_COLOR: Record<string, string> = {
  green: '10', // Basil
  blue: '9', // Blueberry
  red: '11', // Tomato
  orange: '6', // Tangerine
  purple: '1', // Lavender (light purple)
  accent: '4', // Flamingo
  yellow: '5', // Banana
};
const GOOGLE_TO_SITE_COLOR: Record<string, string> = {
  '10': 'green',
  '2': 'green', // Sage — also treated as green if set directly on Google
  '9': 'blue',
  '7': 'blue', // Peacock — also treated as blue if set directly on Google
  '11': 'red',
  '6': 'orange',
  '1': 'purple',
  '3': 'purple', // Grape — also treated as purple if set directly on Google
  '4': 'accent',
  '5': 'yellow', // Banana
};

export function siteColorToGoogleColorId(color: string | null | undefined): string | undefined {
  return SITE_TO_GOOGLE_COLOR[color ?? 'accent'];
}

export function googleColorIdToSiteColor(colorId: string | null | undefined): string {
  return (colorId && GOOGLE_TO_SITE_COLOR[colorId]) || 'accent';
}

export interface WeeklyRecurrenceOptions {
  byDay: string[]; // e.g. ['SU', 'WE']
  interval?: number; // every N weeks; defaults to 1
  count?: number;
  until?: string; // ISO date (YYYY-MM-DD), inclusive
}

export function buildWeeklyRecurrenceRule(opts: WeeklyRecurrenceOptions): string[] {
  const parts = ['FREQ=WEEKLY'];
  if (opts.interval && opts.interval > 1) parts.push(`INTERVAL=${opts.interval}`);
  if (opts.byDay.length) parts.push(`BYDAY=${opts.byDay.join(',')}`);
  if (opts.count) {
    parts.push(`COUNT=${opts.count}`);
  } else if (opts.until) {
    const untilStamp = `${opts.until.replace(/-/g, '')}T235959Z`;
    parts.push(`UNTIL=${untilStamp}`);
  }
  return [`RRULE:${parts.join(';')}`];
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    // Non-null: the module-level guard above throws at import time if these
    // are missing, but TS can't carry that narrowing into this function.
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let googleError: string | undefined;
    try {
      googleError = JSON.parse(body).error;
    } catch {
      // Non-JSON error body — fall through to the generic error below.
    }
    if (googleError === 'invalid_grant') {
      throw new GoogleAuthError(`Failed to refresh Google access token: ${res.status} ${body}`);
    }
    throw new Error(`Failed to refresh Google access token: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data.access_token as string;
}

// Google rejected a stored refresh token as expired/revoked (invalid_grant).
export class GoogleAuthError extends Error {}

export class GoogleNotConnectedError extends Error {
  constructor() {
    super('No admin has connected Google Calendar yet — sign in at /admin with Google first.');
  }
}

export class GoogleAuthExpiredError extends Error {
  constructor() {
    super('Google connection expired — sign out of /admin and sign back in with Google.');
  }
}

// Every stored admin token is tried freshest-first, skipping any Google has
// rejected as expired/revoked, so one dead token (e.g. a second admin who
// hasn't signed in lately) can't take the whole calendar sync down with it.
export async function getGoogleAccessToken(): Promise<string> {
  const { data: rows, error } = await supabase
    .from('admin_google_tokens')
    .select('email, refresh_token')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Failed to load admin Google token: ${error.message}`);
  if (!rows || rows.length === 0) throw new GoogleNotConnectedError();

  for (const row of rows) {
    try {
      return await refreshAccessToken(row.refresh_token);
    } catch (err) {
      if (err instanceof GoogleAuthError) {
        console.warn(`Stored Google token for ${row.email} was rejected (expired or revoked); trying the next one.`);
        continue;
      }
      throw err;
    }
  }

  throw new GoogleAuthExpiredError();
}

export async function listCalendarEvents(
  accessToken: string,
  visibility: EventVisibility,
  timeMin: string,
  timeMax: string
): Promise<GoogleCalendarEvent[]> {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(calendarApiBase(visibility));
    url.searchParams.set('timeMin', timeMin);
    url.searchParams.set('timeMax', timeMax);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '250');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      throw new Error(`Failed to list Google Calendar events: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    events.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

export async function insertCalendarEvent(
  accessToken: string,
  visibility: EventVisibility,
  event: {
    siteEventId: string;
    summary: string;
    description?: string | null;
    location?: string | null;
    startTime: string;
    endTime: string;
    color?: string | null;
    recurrence?: string[];
  }
): Promise<GoogleCalendarEvent> {
  const res = await fetch(calendarApiBase(visibility), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: event.summary,
      description: event.description ?? undefined,
      location: event.location ?? undefined,
      start: { dateTime: event.startTime, timeZone: TIME_ZONE },
      end: { dateTime: event.endTime, timeZone: TIME_ZONE },
      colorId: siteColorToGoogleColorId(event.color),
      recurrence: event.recurrence,
      extendedProperties: { private: { siteEventId: event.siteEventId } },
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create Google Calendar event: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

export async function updateCalendarEvent(
  accessToken: string,
  visibility: EventVisibility,
  googleEventId: string,
  event: {
    summary: string;
    description?: string | null;
    location?: string | null;
    startTime: string;
    endTime: string;
    color?: string | null;
  }
): Promise<GoogleCalendarEvent> {
  const res = await fetch(`${calendarApiBase(visibility)}/${encodeURIComponent(googleEventId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: event.summary,
      description: event.description ?? undefined,
      location: event.location ?? undefined,
      start: { dateTime: event.startTime, timeZone: TIME_ZONE },
      end: { dateTime: event.endTime, timeZone: TIME_ZONE },
      colorId: siteColorToGoogleColorId(event.color),
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to update Google Calendar event: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

export async function deleteCalendarEvent(
  accessToken: string,
  visibility: EventVisibility,
  googleEventId: string
): Promise<void> {
  const res = await fetch(`${calendarApiBase(visibility)}/${encodeURIComponent(googleEventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // 410 Gone means it's already deleted on Google's side — treat as success.
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    throw new Error(`Failed to delete Google Calendar event: ${res.status} ${await res.text()}`);
  }
}
