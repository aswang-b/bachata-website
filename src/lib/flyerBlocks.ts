import type { ClassSeriesEntry } from './classSeries';
import { getActivePrice, priceTierLabel } from './pricing';
import { dealHomepageDefault, type Deal } from './deals';
import { siteFormatter, zonedDateKey, zonedTimeOfDay } from './siteTime';

// The flyer homepage (/test while it's being tried out): offerings advertised
// on the same flyer (the same flyer_url, migration 0055) share one block, with
// the flyer shown whole beside live details. Pure, so it's unit-tested.

export interface FlyerBlock {
  key: string;
  flyerUrl: string | null;
  offerings: ClassSeriesEntry[];
}

// One block per flyer, plus one per offering without a flyer, in the order
// their first offering appears in `offerings` (already in the saved card order).
export function groupByFlyer(offerings: ClassSeriesEntry[]): FlyerBlock[] {
  const blocks: FlyerBlock[] = [];
  const byFlyer = new Map<string, FlyerBlock>();
  for (const offering of offerings) {
    const existing = offering.flyerUrl ? byFlyer.get(offering.flyerUrl) : undefined;
    if (existing) {
      existing.offerings.push(offering);
      continue;
    }
    const block: FlyerBlock = { key: offering.key, flyerUrl: offering.flyerUrl, offerings: [offering] };
    if (offering.flyerUrl) byFlyer.set(offering.flyerUrl, block);
    blocks.push(block);
  }
  return blocks;
}

export function formatPrice(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

type PriceField = 'whole' | 'dropIn' | 'student';

function tierInput(offering: ClassSeriesEntry, field: PriceField) {
  const pick = <T>(whole: T, dropIn: T, student: T) => (field === 'whole' ? whole : field === 'dropIn' ? dropIn : student);
  return {
    base: pick(offering.priceWholeSeries, offering.priceDropIn, offering.priceStudent),
    earlyBird: pick(offering.priceWholeSeriesEarlyBird, offering.priceDropInEarlyBird, offering.priceStudentEarlyBird),
    earlyBirdUntil: offering.earlyBirdUntil,
    flashSale: pick(offering.priceWholeSeriesFlashSale, offering.priceDropInFlashSale, offering.priceStudentFlashSale),
    flashSaleUntil: offering.flashSaleUntil,
  };
}

export interface PriceOption {
  label: string;
  price: number;
  // The regular price when a discount is on, to show crossed out.
  was: number | null;
  tag: string;
  suffix: string;
  // When the deal ends, for a deal that's on (dealEnds).
  ends: DealEnds | null;
}

export interface DealEnds {
  // Beside the price: "ends Nov 3", or in its last week "3 days left",
  // "ends tomorrow" or "ends today".
  short: string;
  // In the bubble over it, "Nov 3 at 11:59 PM", and as one sentence for
  // screen readers: "Early Bird ends Nov 3 at 11:59 PM".
  when: string;
  detail: string;
}

export function dealEnds(tag: string, until: string, now: Date): DealEnds {
  // A deal until midnight lasts through the day before: shown as ending at 11:59 PM.
  const end = new Date(Date.parse(until) - (zonedTimeOfDay(until) === '00:00' ? 60000 : 0));
  const day = siteFormatter({ month: 'short', day: 'numeric' }).format(end);
  const time = siteFormatter({ hour: 'numeric', minute: '2-digit' }).format(end);
  // Calendar days in the site's zone, so "tomorrow" means the next date there.
  const days = Math.round((Date.parse(zonedDateKey(end)) - Date.parse(zonedDateKey(now))) / 86400000);
  const short = days <= 0 ? 'ends today' : days === 1 ? 'ends tomorrow' : days <= 7 ? `${days} days left` : `ends ${day}`;
  const when = `${day} at ${time}`;
  return { short, when, detail: `${tag} ends ${when}` };
}

// Today's prices for one offering, the same choices the old homepage cards
// listed: an event's ticket, or a class's whole series / drop in / student.
export function priceOptions(offering: ClassSeriesEntry, now: Date): PriceOption[] {
  const option = (label: string, field: PriceField, suffix = ''): PriceOption | null => {
    const input = tierInput(offering, field);
    if (input.base == null) return null;
    const result = getActivePrice(now, input);
    const discounted = result.display === 'discounted';
    const tag = discounted ? priceTierLabel(result.tag) : '';
    const until = result.tag === 'flash_sale' ? input.flashSaleUntil : input.earlyBirdUntil;
    return { label, price: result.activePrice!, was: discounted ? result.originalPrice : null, tag, suffix, ends: discounted && until ? dealEnds(tag, until, now) : null };
  };
  if (offering.eventType === 'event') return [option('Ticket', 'whole')].filter((o): o is PriceOption => o != null);
  const perClass = '/class';
  const options = [
    option(offering.isSeries ? 'Series' : 'Price', 'whole'),
    // A one-off class with only a drop-in price (e.g. a practica) still shows that price.
    offering.isSeries || offering.priceWholeSeries == null ? option('Drop in', 'dropIn', offering.isSeries ? perClass : '') : null,
    option('Student', 'student', perClass),
  ];
  return options.filter((o): o is PriceOption => o != null);
}

// Deals whose classes are all in this block (an "any N" deal needs N of them
// here), for the block's note: the admin's own text, or the name and the default.
export function blockDeals(offerings: ClassSeriesEntry[], deals: Deal[]): { name: string; text: string; custom: boolean }[] {
  const keys = new Set(offerings.map((o) => o.key));
  return deals
    .filter((d) => {
      const here = d.seriesKeys.filter((k) => keys.has(k)).length;
      return d.requiredCount == null ? here === d.seriesKeys.length && here > 1 : here >= d.requiredCount;
    })
    .map((d) => (d.homepageText ? { name: d.name, text: d.homepageText, custom: true } : { name: d.name, text: dealHomepageDefault(d), custom: false }));
}

// The first and last class of each series, past ones included (rows from
// every occurrence, not just upcoming ones).
export function seriesBounds(rows: { id: string; google_recurring_event_id: string | null; start_time: string }[]): Map<string, { first: string; last: string }> {
  const bounds = new Map<string, { first: string; last: string }>();
  for (const r of rows) {
    const key = r.google_recurring_event_id ?? r.id;
    const b = bounds.get(key);
    if (!b) bounds.set(key, { first: r.start_time, last: r.start_time });
    else {
      if (Date.parse(r.start_time) < Date.parse(b.first)) b.first = r.start_time;
      if (Date.parse(r.start_time) > Date.parse(b.last)) b.last = r.start_time;
    }
  }
  return bounds;
}

// "Oct 25 – Nov 15": the whole series, from its first class even once that
// has passed (`bounds` from seriesBounds), or the one date.
export function dateRange(offering: ClassSeriesEntry, bounds?: Map<string, { first: string; last: string }>): string {
  const fmt = siteFormatter({ month: 'short', day: 'numeric' });
  const whole = bounds?.get(offering.key);
  const first = whole?.first ?? offering.occurrences[0]?.startTime ?? offering.nextStartTime;
  const last = whole?.last ?? offering.occurrences[offering.occurrences.length - 1]?.startTime ?? first;
  const a = fmt.format(new Date(first));
  const b = fmt.format(new Date(last));
  return a === b ? a : `${a} – ${b}`;
}
