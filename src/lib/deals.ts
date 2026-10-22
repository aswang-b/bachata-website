// Bundle deals (admin → Deals): discounts for taking several classes or
// events together. Pure functions, shared by the registration form (live
// subtotal and "add this to get the deal" suggestions) and the server (the
// prices actually saved), so both always agree.
//
// A deal covers a set of series keys (`google_recurring_event_id ?? id`) and
// applies when one dancer picks all of them, or any `requiredCount` of them.
// Its discount is a bundle price ("$40 for both"), an amount off, or a percent
// off the picked classes' current prices (early bird / flash sale included).
// Only Whole Series sign-ups, one-off classes and event tickets count; a
// single Drop-In date never does. A deal only applies when it lowers the
// price (so the dancer always pays the best price), each class counts toward
// one deal at most, the biggest saving is applied first, and an "any N" deal
// can apply more than once (6 workshops on "any 3 for $90" is two bundles).

export type DealKind = 'bundle_price' | 'amount_off' | 'percent_off';
export const DEAL_KINDS: DealKind[] = ['bundle_price', 'amount_off', 'percent_off'];

export interface Deal {
  id: string;
  name: string;
  kind: DealKind;
  amount: number;
  seriesKeys: string[];
  // null: every class in the deal; N: any N of them.
  requiredCount: number | null;
}

// One picked class for one dancer. `price` is what it costs without a deal.
export interface DealItem {
  key: string;
  price: number | null;
  eligible: boolean;
}

export interface ItemDiscount {
  dealId: string;
  dealName: string;
  amount: number;
}

export interface DealResult {
  // Per item, by its index in the list passed in; null when no deal applied.
  discounts: (ItemDiscount | null)[];
  totalDiscount: number;
  // Each time a deal applied: its name and what it saved.
  applied: { dealId: string; dealName: string; amount: number }[];
}

const cents = (n: number) => Math.round(n * 100) / 100;

function discountFor(deal: Deal, sum: number): number {
  const off = deal.kind === 'bundle_price' ? sum - deal.amount : deal.kind === 'amount_off' ? Math.min(deal.amount, sum) : (sum * Math.min(deal.amount, 100)) / 100;
  return cents(Math.max(0, off));
}

// The items one application of `deal` would use from `open` (indexes into
// `items`): one per class (the dearest, if a class was somehow picked twice),
// all of the deal's classes, or the N dearest for "any N". null if it can't apply.
function pickFor(deal: Deal, items: DealItem[], open: Set<number>): number[] | null {
  const best = new Map<string, number>();
  for (const i of open) {
    const item = items[i];
    if (!deal.seriesKeys.includes(item.key)) continue;
    const current = best.get(item.key);
    if (current === undefined || (items[i].price ?? 0) > (items[current].price ?? 0)) best.set(item.key, i);
  }
  const candidates = [...best.values()].sort((a, b) => (items[b].price ?? 0) - (items[a].price ?? 0));
  if (deal.requiredCount == null) {
    return candidates.length === new Set(deal.seriesKeys).size ? candidates : null;
  }
  return candidates.length >= deal.requiredCount ? candidates.slice(0, deal.requiredCount) : null;
}

export function applyDeals(items: DealItem[], deals: Deal[]): DealResult {
  const discounts: (ItemDiscount | null)[] = items.map(() => null);
  const applied: DealResult['applied'] = [];
  const open = new Set(items.flatMap((item, i) => (item.eligible && item.price != null && item.price > 0 ? [i] : [])));

  for (;;) {
    let bestPick: { deal: Deal; picked: number[]; sum: number; discount: number } | null = null;
    for (const deal of deals) {
      const picked = pickFor(deal, items, open);
      if (!picked) continue;
      const sum = picked.reduce((s, i) => s + (items[i].price ?? 0), 0);
      const discount = discountFor(deal, sum);
      if (discount > 0 && (!bestPick || discount > bestPick.discount)) bestPick = { deal, picked, sum, discount };
    }
    if (!bestPick) break;

    // Split the saving across the classes by price, in cents, the rounding
    // left over going to the last one, so the shares add up exactly.
    const { deal, picked, sum, discount } = bestPick;
    let left = discount;
    picked.forEach((i, n) => {
      const share = n === picked.length - 1 ? cents(left) : cents((discount * (items[i].price ?? 0)) / sum);
      left = cents(left - share);
      discounts[i] = { dealId: deal.id, dealName: deal.name, amount: share };
      open.delete(i);
    });
    applied.push({ dealId: deal.id, dealName: deal.name, amount: discount });
  }

  return { discounts, totalDiscount: cents(applied.reduce((s, a) => s + a.amount, 0)), applied };
}

// A class the dancer could add to unlock a deal they're one class short of,
// and what adding it would save on top of its own price.
export interface DealSuggestion {
  dealId: string;
  dealName: string;
  key: string;
  saving: number;
}

// For each deal the picked classes are exactly one class short of: the
// available classes (`addable`, at their Whole Series / ticket price) that
// would complete it, with what each saves. Biggest saving first.
export function suggestDeals(items: DealItem[], deals: Deal[], addable: { key: string; price: number }[]): DealSuggestion[] {
  const base = applyDeals(items, deals);
  const picked = new Set(items.map((i) => i.key));
  const suggestions: DealSuggestion[] = [];
  for (const deal of deals) {
    const inDeal = items.filter((i) => i.eligible && deal.seriesKeys.includes(i.key)).length;
    if (inDeal === 0) continue;
    for (const option of addable) {
      if (picked.has(option.key) || !deal.seriesKeys.includes(option.key)) continue;
      const withIt = applyDeals([...items, { key: option.key, price: option.price, eligible: true }], [deal]);
      const usedNew = withIt.discounts[items.length]?.dealId === deal.id;
      if (!usedNew) continue;
      // Compared against the best the dancer gets today with every deal.
      const all = applyDeals([...items, { key: option.key, price: option.price, eligible: true }], deals);
      const saving = cents(all.totalDiscount - base.totalDiscount);
      if (saving > 0) suggestions.push({ dealId: deal.id, dealName: deal.name, key: option.key, saving });
    }
  }
  // One suggestion per class (its best deal).
  const byKey = new Map<string, DealSuggestion>();
  for (const s of suggestions) {
    const current = byKey.get(s.key);
    if (!current || s.saving > current.saving) byKey.set(s.key, s);
  }
  return [...byKey.values()].sort((a, b) => b.saving - a.saving);
}

// "Both for $40", "$10 off", "20% off", with "any 3" when it's an any-N deal.
export function dealSummary(deal: Pick<Deal, 'kind' | 'amount' | 'requiredCount'>, classCount: number): string {
  const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
  const which = deal.requiredCount == null ? (classCount === 2 ? 'both' : `all ${classCount}`) : `any ${deal.requiredCount}`;
  if (deal.kind === 'bundle_price') return `${which[0].toUpperCase()}${which.slice(1)} for ${money(deal.amount)}`;
  const off = deal.kind === 'amount_off' ? money(deal.amount) : `${deal.amount}%`;
  return `${off} off ${which}`;
}
