import type { ClassSeriesEntry } from './classSeries';
import { getActivePrice, priceTierLabel } from './pricing';
import { dealSummary, type Deal } from './deals';
import { siteFormatter } from './siteTime';

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
}

// Today's prices for one offering, the same choices the old homepage cards
// listed: an event's ticket, or a class's whole series / drop in / student.
export function priceOptions(offering: ClassSeriesEntry, now: Date): PriceOption[] {
  const option = (label: string, field: PriceField, suffix = ''): PriceOption | null => {
    const input = tierInput(offering, field);
    if (input.base == null) return null;
    const result = getActivePrice(now, input);
    const discounted = result.display === 'discounted';
    return { label, price: result.activePrice!, was: discounted ? result.originalPrice : null, tag: discounted ? priceTierLabel(result.tag) : '', suffix };
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
// here), described for the block: "Both for $140".
export function blockDeals(offerings: ClassSeriesEntry[], deals: Deal[]): { name: string; summary: string }[] {
  const keys = new Set(offerings.map((o) => o.key));
  return deals
    .filter((d) => {
      const here = d.seriesKeys.filter((k) => keys.has(k)).length;
      return d.requiredCount == null ? here === d.seriesKeys.length && here > 1 : here >= d.requiredCount;
    })
    .map((d) => ({ name: d.name, summary: dealSummary(d, d.seriesKeys.length) }));
}

// "Oct 25 – Nov 15" across a series' remaining dates, or the one date.
export function dateRange(offering: ClassSeriesEntry): string {
  const fmt = siteFormatter({ month: 'short', day: 'numeric' });
  const first = offering.occurrences[0]?.startTime ?? offering.nextStartTime;
  const last = offering.occurrences[offering.occurrences.length - 1]?.startTime ?? first;
  const a = fmt.format(new Date(first));
  const b = fmt.format(new Date(last));
  return a === b ? a : `${a} – ${b}`;
}
