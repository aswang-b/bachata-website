// What the public calendar and the admin editor (loaded only for admins,
// see adminGate.ts) both read or set.
import type { SiteEvent } from './types';

export const shared = {
  adminModeActive: false,
  // The event open in the details panel.
  detailEvent: null as SiteEvent | null,
  // Set by the admin editor when it starts: opens it to add a class on that
  // day (a click on a day's empty space, admins only).
  openAddForDay: null as ((dateKey: string) => void) | null,
};
