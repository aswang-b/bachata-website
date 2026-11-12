// A class's schedule in one line, in its own zone with its zone label only when
// its clock differs from the site's: "Sat, Aug 8 · 8:00 PM–9:00 PM" for one
// date, the series wording ("Saturdays, 8:00 PM–9:00 PM (Aug 8–Aug 29)") for a
// series. Link previews and shared flyer captions both use it. Pure.
import { eventDate, eventTimeRange } from './eventClock';
import { seriesSubLabel } from './registrationLabels';

interface ScheduleRow {
  start_time: string;
  end_time: string;
  time_zone?: string | null;
}

// `rows`: the class's classes still to come, soonest first; `whole`: the series'
// first and last class, past ones included (flyerBlocks.seriesBounds); `total`: its class count.
export function scheduleLine(opts: { rows: ScheduleRow[]; whole?: { first: string; last: string }; total?: number; isEvent: boolean }): string {
  const first = opts.rows[0];
  const last = opts.rows[opts.rows.length - 1];
  if ((opts.total ?? opts.rows.length) > 1) return seriesSubLabel(first, last, opts.whole, true, opts.isEvent);
  return `${eventDate(first)} · ${eventTimeRange(first)}`;
}
