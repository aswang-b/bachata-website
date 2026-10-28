import { runCalendarSync } from '../../src/lib/calendarSync';
import { loadSiteTimeZone } from '../../src/lib/siteConfig';
import { setServerTimeZone } from '../../src/lib/siteTime';
import { sendStaleAdminCopies } from '../../src/lib/confirmationAdminCopy';

// Two independent jobs, run side by side so a slow Google sync can't use up
// the function's time before the admins' copies go out.
export default async () => {
  // No middleware runs for a scheduled function: load the site time zone for
  // the events the sync creates and the dates in the copies.
  try {
    setServerTimeZone(await loadSiteTimeZone());
  } catch (err) {
    console.error('Loading the site time zone failed:', err);
  }
  await Promise.allSettled([
    (async () => {
      try {
        const result = await runCalendarSync();
        console.log('Scheduled calendar sync completed:', result);
      } catch (err) {
        console.error('Scheduled calendar sync failed:', err);
      }
    })(),
    // Admins' confirmation copies that Resend never reported on (lib/confirmationAdminCopy.ts).
    (async () => {
      try {
        const sent = await sendStaleAdminCopies();
        if (sent > 0) console.log('Sent waiting admin confirmation copies:', sent);
      } catch (err) {
        console.error('Sending waiting admin confirmation copies failed:', err);
      }
    })(),
  ]);
};

export const config = {
  schedule: '*/15 * * * *',
};
