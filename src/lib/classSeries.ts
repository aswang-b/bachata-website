export const TIME_ZONE = 'America/Chicago';

export interface ClassOccurrenceRow {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  google_recurring_event_id: string | null;
  price_whole_series?: number | null;
  price_drop_in?: number | null;
  price_student?: number | null;
  description?: string | null;
  location?: string | null;
  image_url?: string | null;
  event_type?: string;
  color?: string | null;
}

export interface ClassSeriesOccurrence {
  id: string;
  label: string;
  startTime: string;
}

export interface ClassSeriesEntry {
  key: string;
  title: string;
  isSeries: boolean;
  subLabel: string;
  singleEventId: string | null;
  occurrences: ClassSeriesOccurrence[];
  priceWholeSeries: number | null;
  priceDropIn: number | null;
  priceStudent: number | null;
  description: string | null;
  location: string | null;
  imageUrl: string | null;
  eventType: string;
  nextStartTime: string;
  color: string;
}

const weekdayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: TIME_ZONE });
const dateFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TIME_ZONE });
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE });

// Groups class occurrences into one entry per recurring series (or per
// standalone class), matching the selector on the public check-in form.
export function buildClassSeriesList(events: ClassOccurrenceRow[]): ClassSeriesEntry[] {
  const seriesMap = new Map<string, ClassOccurrenceRow[]>();
  for (const event of events) {
    const key = event.google_recurring_event_id ?? event.id;
    const existing = seriesMap.get(key) ?? [];
    existing.push(event);
    seriesMap.set(key, existing);
  }

  return Array.from(seriesMap.entries()).map(([key, occurrences]) => {
    const sorted = [...occurrences].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    const first = sorted[0];
    const isSeries = sorted.length > 1;
    const timeRange = `${timeFormatter.format(new Date(first.start_time))}–${timeFormatter.format(new Date(first.end_time))}`;

    return {
      key,
      title: first.title,
      isSeries,
      subLabel: isSeries
        ? `${weekdayFormatter.format(new Date(first.start_time))}s, ${timeRange}`
        : `${dateFormatter.format(new Date(first.start_time))}, ${timeRange}`,
      singleEventId: isSeries ? null : first.id,
      occurrences: sorted.map((occ) => ({
        id: occ.id,
        label: `${dateFormatter.format(new Date(occ.start_time))}, ${timeFormatter.format(new Date(occ.start_time))}`,
        startTime: occ.start_time,
      })),
      priceWholeSeries: first.price_whole_series ?? null,
      priceDropIn: first.price_drop_in ?? null,
      priceStudent: first.price_student ?? null,
      description: first.description ?? null,
      location: first.location ?? null,
      imageUrl: first.image_url ?? null,
      eventType: first.event_type ?? 'class',
      nextStartTime: first.start_time,
      color: first.color ?? 'accent',
    };
  });
}
