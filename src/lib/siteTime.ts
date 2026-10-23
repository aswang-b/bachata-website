// The site's time zone (admin → General → Site Time Zone): every date and
// time on the site is shown, grouped into days and typed into the editor in
// it, wherever the server (UTC on Netlify) or the visitor happens to be.
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

// An Intl.DateTimeFormat in the site's zone (cached per zone and options).
export function siteFormatter(options: Intl.DateTimeFormatOptions, locale = 'en-US'): Intl.DateTimeFormat {
  const timeZone = siteTimeZone();
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    formatters.set(key, f);
  }
  return f;
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
