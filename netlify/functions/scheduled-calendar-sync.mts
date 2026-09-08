import { runCalendarSync } from '../../src/lib/calendarSync';

export default async () => {
  try {
    const result = await runCalendarSync();
    console.log('Scheduled calendar sync completed:', result);
  } catch (err) {
    console.error('Scheduled calendar sync failed:', err);
  }
};

export const config = {
  schedule: '*/15 * * * *',
};
