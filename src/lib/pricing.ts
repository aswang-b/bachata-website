// Pure — no supabase/env imports — so it's safe to import both from Astro
// frontmatter (SSR) and from calendar.astro's client <script> bundle.

export type PriceTier = 'regular' | 'early_bird' | 'flash_sale';

export interface TieredPriceInput {
  base: number | null;
  earlyBird: number | null;
  earlyBirdUntil: string | null;
  flashSale: number | null;
  flashSaleUntil: string | null;
}

export interface ActivePriceResult {
  display: 'original' | 'discounted';
  originalPrice: number | null;
  activePrice: number | null;
  tag: PriceTier;
}

// Deterministic given `now` — a discount is active when its price is set
// and `now` is before its expiration. If both tiers are active, the
// cheaper one wins; a tie goes to flash sale (more time-urgent framing —
// the price charged is identical either way).
export function getActivePrice(now: Date, input: TieredPriceInput): ActivePriceResult {
  const { base, earlyBird, earlyBirdUntil, flashSale, flashSaleUntil } = input;

  const earlyBirdActive = earlyBird != null && earlyBirdUntil != null && now.getTime() < new Date(earlyBirdUntil).getTime();
  const flashSaleActive = flashSale != null && flashSaleUntil != null && now.getTime() < new Date(flashSaleUntil).getTime();

  if (!earlyBirdActive && !flashSaleActive) {
    return { display: 'original', originalPrice: base, activePrice: base, tag: 'regular' };
  }

  if (earlyBirdActive && flashSaleActive) {
    const flashSaleWins = (flashSale as number) <= (earlyBird as number);
    return {
      display: 'discounted',
      originalPrice: base,
      activePrice: flashSaleWins ? (flashSale as number) : (earlyBird as number),
      tag: flashSaleWins ? 'flash_sale' : 'early_bird',
    };
  }

  if (flashSaleActive) {
    return { display: 'discounted', originalPrice: base, activePrice: flashSale as number, tag: 'flash_sale' };
  }

  return { display: 'discounted', originalPrice: base, activePrice: earlyBird as number, tag: 'early_bird' };
}

export function priceTierLabel(tag: PriceTier): string {
  return tag === 'flash_sale' ? 'Flash Sale' : tag === 'early_bird' ? 'Early Bird' : '';
}
