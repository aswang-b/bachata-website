import { runCalendarSync } from '../../src/lib/calendarSync';
import { loadSiteTimeZone } from '../../src/lib/siteConfig';
import { setServerTimeZone } from '../../src/lib/siteTime';

export default async () => {
  try {
    // No middleware runs for a scheduled function: load the site time zone for any events it creates.
    setServerTimeZone(await loadSiteTimeZone());
    const result = await runCalendarSync();
    console.log('Scheduled calendar sync completed:', result);
  } catch (err) {
    console.error('Scheduled calendar sync failed:', err);
  }
};

export const config = {
  schedule: '*/15 * * * *',
};
