import { runCalendarSync } from '../../src/lib/calendarSync';
import { loadSiteTimeZone } from '../../src/lib/siteConfig';
import { setServerTimeZone } from '../../src/lib/siteTime';
import { sendStaleAdminCopies } from '../../src/lib/confirmationAdminCopy';

export default async () => {
  try {
    // No middleware runs for a scheduled function: load the site time zone for any events it creates.
    setServerTimeZone(await loadSiteTimeZone());
    const result = await runCalendarSync();
    console.log('Scheduled calendar sync completed:', result);
  } catch (err) {
    console.error('Scheduled calendar sync failed:', err);
  }
  // Admins' confirmation copies that Resend never reported on (lib/confirmationAdminCopy.ts).
  try {
    const sent = await sendStaleAdminCopies();
    if (sent > 0) console.log('Sent waiting admin confirmation copies:', sent);
  } catch (err) {
    console.error('Sending waiting admin confirmation copies failed:', err);
  }
};

export const config = {
  schedule: '*/15 * * * *',
};
