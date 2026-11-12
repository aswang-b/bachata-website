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
