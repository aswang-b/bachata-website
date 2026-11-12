// The site's time zone (admin → Admin → Site Time Zone): dates and times on
// the site are shown, grouped into days and typed in it, wherever the server
// (UTC on Netlify) or the visitor happens to be; a class's own date and time
// in its own zone instead (eventZone below, migration 0076).
// Pure apart from where the zone comes from, so it runs on the server and in
// the browser alike.
//
// Where it comes from: on the server, src/middleware.ts loads the saved
// setting (siteConfig.ts) at the start of every request and calls
// setServerTimeZone; in the browser, BaseLayout writes it into
// <meta name="site-time-zone">.

export const DEFAULT_TIME_ZONE = 'America/Chicago';

let serverTimeZone = DEFAULT_TIME_ZONE;

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function setServerTimeZone(tz: string) {
  serverTimeZone = isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
}

export function siteTimeZone(): string {
  if (typeof document !== 'undefined') {
    const tz = document.querySelector<HTMLMetaElement>('meta[name="site-time-zone"]')?.content;
    return isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
  }
  return serverTimeZone;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

// An Intl.DateTimeFormat in the site's zone, or in `tz` (a class's own zone),
// cached per zone and options.
export function siteFormatter(options: Intl.DateTimeFormatOptions, locale = 'en-US', tz?: string): Intl.DateTimeFormat {
  const timeZone = tz && isValidTimeZone(tz) ? tz : siteTimeZone();
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    formatters.set(key, f);
  }
  return f;
}

// A class's own zone (events.time_zone, migration 0076): the zone its date and
// times were typed in. A class is shown in it; "now"-level things (today,
// deal ends, submitted-at times) stay in the site's zone.
export function eventZone(row: { time_zone?: string | null } | null | undefined): string {
  const tz = row?.time_zone;
  return isValidTimeZone(tz) ? tz : siteTimeZone();
}

// A short name for a zone at an instant: "MT", "CT", "PT" (Intl's generic
// name), or the specific one ("MST", "GMT+1") where the generic name is a
// phrase ("United Kingdom Time").
export function zoneLabel(date: Date | string | number, tz: string): string {
  const name = (style: 'shortGeneric' | 'short') =>
    siteFormatter({ hour: 'numeric', timeZoneName: style }, 'en-US', tz)
      .formatToParts(new Date(date))
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  const generic = name('shortGeneric');
  return generic && !generic.includes(' ') ? generic : name('short');
}

// Minutes the zone is ahead of UTC at an instant.
function utcOffsetMinutes(date: Date | string | number, tz: string): number {
  const t = Math.floor(new Date(date).getTime() / 60000) * 60000;
  const p = zonedParts(t, tz);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t) / 60000);
}

// Whether a class's time needs its zone printed after it: only when its
// zone's clock differs from the site's at that instant (another id for the
// same clock prints nothing).
export function showsOwnZone(date: Date | string | number, tz: string): boolean {
  if (!isValidTimeZone(tz)) return false;
  const site = siteTimeZone();
  return tz !== site && utcOffsetMinutes(date, tz) !== utcOffsetMinutes(date, site);
}

// " MT" to put after a class's time or time range, or '' on the site's clock.
export function zoneSuffix(date: Date | string | number, tz: string): string {
  return showsOwnZone(date, tz) ? ` ${zoneLabel(date, tz)}` : '';
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The wall-clock date and time of an instant in the site's zone.
export function zonedParts(date: Date | string | number, tz = siteTimeZone()): ZonedParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' })
      .formatToParts(new Date(date))
      .map((p) => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

// "YYYY-MM-DD" of an instant's day in the site's zone.
export function zonedDateKey(date: Date | string | number, tz = siteTimeZone()): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// "HH:mm" of an instant in the site's zone.
export function zonedTimeOfDay(date: Date | string | number, tz = siteTimeZone()): string {
  const p = zonedParts(date, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

// The instant of a wall-clock date ("YYYY-MM-DD") and time ("HH:mm") in the
// site's zone. Two passes, so a date on the other side of a DST change gets
// its own offset.
export function zonedToInstant(date: string, time = '00:00', tz = siteTimeZone()): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(guess, tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wall - shown;
  }
  return new Date(guess);
}

// A "YYYY-MM-DD" key n days later (calendar arithmetic, no time zone involved).
export function addDaysToKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
