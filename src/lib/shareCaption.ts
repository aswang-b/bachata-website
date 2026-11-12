// The caption an admin posts with a class's flyer (WhatsApp groups, Instagram):
// plain text, one item per line, a line left out when it has no value:
//   class name / date line / venue · city / price line / the class's link.
// Dates are in the class's own zone (classSchedule.ts), prices as the site shows
// them today (the homepage block's wording). Pure.
import { scheduleLine } from './classSchedule';
import { formatPrice } from './flyerBlocks';
import { getActivePrice, priceTierLabel } from './pricing';
import { withAwayCity } from './siteLocation';

export interface CaptionEvent {
  title: string;
  event_type: string;
  start_time: string;
  end_time: string;
  time_zone?: string | null;
  location?: string | null;
  city?: string | null;
  price_whole_series?: number | null;
  price_drop_in?: number | null;
  price_student?: number | null;
  price_whole_series_early_bird?: number | null;
  price_drop_in_early_bird?: number | null;
  price_student_early_bird?: number | null;
  early_bird_until?: string | null;
  price_whole_series_flash_sale?: number | null;
  price_drop_in_flash_sale?: number | null;
  price_student_flash_sale?: number | null;
  flash_sale_until?: string | null;
}

type Field = 'whole' | 'dropIn' | 'student';

function priceText(label: string, event: CaptionEvent, field: Field, now: Date, suffix = ''): string | null {
  const pick = <T>(w: T, d: T, s: T) => (field === 'whole' ? w : field === 'dropIn' ? d : s);
  const base = pick(event.price_whole_series, event.price_drop_in, event.price_student) ?? null;
  if (base == null) return null;
  const result = getActivePrice(now, {
    base,
    earlyBird: pick(event.price_whole_series_early_bird, event.price_drop_in_early_bird, event.price_student_early_bird) ?? null,
    earlyBirdUntil: event.early_bird_until ?? null,
    flashSale: pick(event.price_whole_series_flash_sale, event.price_drop_in_flash_sale, event.price_student_flash_sale) ?? null,
    flashSaleUntil: event.flash_sale_until ?? null,
  });
  const tag = result.display === 'discounted' ? ` (${priceTierLabel(result.tag)})` : '';
  return `${label}: ${formatPrice(result.activePrice!)}${suffix}${tag}`;
}

// "Series: $50 · Drop in: $15/class · Student: $12/class", an event's "Ticket: $15",
// a one-off class's "Price: $20": the same labels as the homepage block. Empty with no price.
export function captionPrices(event: CaptionEvent, isSeries: boolean, now: Date): string {
  const parts =
    event.event_type === 'event'
      ? [priceText('Ticket', event, 'whole', now)]
      : [
          priceText(isSeries ? 'Series' : 'Price', event, 'whole', now),
          isSeries || event.price_whole_series == null ? priceText('Drop in', event, 'dropIn', now, isSeries ? '/class' : '') : null,
          priceText('Student', event, 'student', now, '/class'),
        ];
  return parts.filter(Boolean).join(' · ');
}

// `upcoming`: the class's classes still to come, soonest first (the clicked one
// when it is the only one); `whole`/`total`: the series' first and last class and class
// count, past ones included. `url`: the class's link, left out for a private class.
export function shareCaption(opts: {
  event: CaptionEvent;
  upcoming?: CaptionEvent[];
  whole?: { first: string; last: string };
  total?: number;
  url?: string | null;
  now?: Date;
}): string {
  const { event } = opts;
  const rows = opts.upcoming && opts.upcoming.length > 0 ? opts.upcoming : [event];
  const isSeries = (opts.total ?? rows.length) > 1;
  const date = scheduleLine({ rows, whole: opts.whole, total: opts.total, isEvent: event.event_type === 'event' });
  // The class's city is always named when it has one (even at home), after the venue.
  const place = withAwayCity(event.location?.trim(), (event.city ?? '').trim() || null);
  return [event.title.trim(), date, place, captionPrices(event, isSeries, opts.now ?? new Date()), opts.url ?? '']
    .filter((line) => line.trim() !== '')
    .join('\n');
}
