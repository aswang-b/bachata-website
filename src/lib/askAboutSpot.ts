import type { SpotsInfo } from './capacity';

// "Ask about a spot": where a dancer meets a class that is full or closed, a
// link opens the Contact form with that class already named. There is no
// waitlist: the message lands in the admin inbox like any other. Pure (the
// class lookup is spotRequest.ts), so the server and the calendar's browser
// script share it.

// The link's text, and its look: the site's quiet text link, with the 44px tap area on touch screens (global.css).
export const ASK_SPOT_LABEL = 'Ask about a spot';
export const ASK_SPOT_CLASS = 'hit-44 relative inline-flex items-center text-xs font-semibold text-accent hover:underline';

// `id` is the class the surrounding UI already uses: a one-off class's id, or a series' key.
export function askAboutSpotHref(id: string): string {
  return `/contact?spot=${encodeURIComponent(id)}`;
}

// Ids are uuids or Google's recurring-event ids (letters, digits, "_" and "-").
// Anything else is no class, without a database lookup.
export function validSpotId(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(raw);
}

export interface AskableInput {
  // Registration is closed by the admin (registration_closed).
  closed: boolean;
  // The class's spots (capacity.ts), or null when it has no capacity.
  spots: SpotsInfo | null;
  // When it (or, for a series, its next class) starts.
  startTime: string;
  now?: Date;
}

// Whether the link shows: the site already says the class is full or its
// registration is closed (or one role is full, which the spots label says
// too), and the class is still to come. A class with spots left, or one that
// has started, never gets it.
export function isAskable({ closed, spots, startTime, now = new Date() }: AskableInput): boolean {
  if (Date.parse(startTime) <= now.getTime()) return false;
  if (closed) return true;
  if (!spots) return false;
  return spots.full || spots.leader?.remaining === 0 || spots.follower?.remaining === 0;
}
