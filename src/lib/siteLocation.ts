// Where the business is right now (Admin → Admin → Where we are; saved by
// lib/siteConfig.ts). Pure, so pages, the structured data and browser code can
// all import it without pulling in Supabase.

export type SiteLocation = { city: string; state: string; note: string };

// What the site said before the setting existed.
export const DEFAULT_LOCATION: SiteLocation = { city: 'Madison', state: 'WI', note: '' };

// "Seattle, WA", or just "Seattle" when there is no state.
export function placeLabel(loc: SiteLocation): string {
  return loc.state ? `${loc.city}, ${loc.state}` : loc.city;
}

// A class's own city (events.city/state, migration 0077; filled by the editor's
// venue lookup). It is shown only when the class is away from home.
export type EventPlace = { city?: string | null; state?: string | null };

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

// The class's city ("Santa Fe", the city alone) when it is set and differs from
// the home city; a different state also counts as away when both have one.
// Otherwise null, and nothing extra is printed.
export function awayCity(event: EventPlace, home: SiteLocation): string | null {
  const city = (event.city ?? '').trim();
  if (!city) return null;
  if (norm(city) !== norm(home.city)) return city;
  const state = norm(event.state);
  const homeState = norm(home.state);
  return state && homeState && state !== homeState ? city : null;
}

// "Venue · Santa Fe"; just the city when there is no venue text; the venue
// untouched when the class is home (away is null).
export function withAwayCity(location: string | null | undefined, away: string | null): string {
  const loc = location ?? '';
  if (!away) return loc;
  return loc.trim() ? `${loc} · ${away}` : away;
}

// A saved city or state: trimmed, at most 80 characters, empty -> null.
export function cleanPlaceText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, 80).trim() || null;
}

// The columns a save writes for the class's place. Left out of the request (an
// older editor), the stored city and state stay as they are.
export function placeColumns(city: unknown, state: unknown): { city?: string | null; state?: string | null } {
  if (city === undefined && state === undefined) return {};
  const c = cleanPlaceText(city);
  return { city: c, state: c ? cleanPlaceText(state) : null };
}
