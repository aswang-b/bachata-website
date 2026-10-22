import { describe, expect, it } from 'vitest';
import { applyDeals, dealSummary, suggestDeals, type Deal, type DealItem } from '../../src/lib/deals';

const zouk: Deal = { id: 'z', name: 'Zouk Pop-Up Bundle', kind: 'bundle_price', amount: 40, seriesKeys: ['intro', 'open'], requiredCount: null };
const item = (key: string, price: number | null, eligible = true): DealItem => ({ key, price, eligible });

describe('applying deals', () => {
  it('a bundle price applies when every class in it is picked, split across them by price', () => {
    const r = applyDeals([item('intro', 25), item('open', 25)], [zouk]);
    expect(r.totalDiscount).toBe(10);
    expect(r.discounts.map((d) => d?.amount)).toEqual([5, 5]);
    expect(r.applied).toEqual([{ dealId: 'z', dealName: 'Zouk Pop-Up Bundle', amount: 10 }]);
  });

  it("doesn't apply with only some of the classes, or when the classes already cost less (best price wins)", () => {
    expect(applyDeals([item('intro', 25)], [zouk]).totalDiscount).toBe(0);
    // Early bird already brings the pair under the bundle price.
    expect(applyDeals([item('intro', 15), item('open', 15)], [zouk]).totalDiscount).toBe(0);
  });

  it('never counts a single Drop-In date', () => {
    expect(applyDeals([item('intro', 25), item('open', 25, false)], [zouk]).totalDiscount).toBe(0);
  });

  it('amount off and percent off, never below zero', () => {
    const amount: Deal = { ...zouk, kind: 'amount_off', amount: 100 };
    expect(applyDeals([item('intro', 25), item('open', 25)], [amount]).totalDiscount).toBe(50);
    const percent: Deal = { ...zouk, kind: 'percent_off', amount: 20 };
    expect(applyDeals([item('intro', 25), item('open', 30)], [percent]).totalDiscount).toBe(11);
  });

  it('an "any N" deal takes the dearest classes, and applies again for each further N', () => {
    const any3: Deal = { id: 'w', name: 'Workshop Pass', kind: 'bundle_price', amount: 90, seriesKeys: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], requiredCount: 3 };
    const one = applyDeals([item('a', 40), item('b', 35), item('c', 30), item('d', 20)], [any3]);
    expect(one.totalDiscount).toBe(15);
    expect(one.discounts[3]).toBeNull();
    const two = applyDeals(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => item(k, 40)), [any3]);
    expect(two.applied).toHaveLength(2);
    expect(two.totalDiscount).toBe(60);
  });

  it('each class counts toward one deal, and the bigger saving wins', () => {
    const small: Deal = { ...zouk, id: 's', name: 'Small', kind: 'amount_off', amount: 5 };
    const r = applyDeals([item('intro', 25), item('open', 25)], [small, zouk]);
    expect(r.applied.map((a) => a.dealId)).toEqual(['z']);
  });

  it('splits an uneven saving to the cent, the shares adding up exactly', () => {
    const third: Deal = { ...zouk, seriesKeys: ['a', 'b', 'c'], kind: 'amount_off', amount: 10 };
    const r = applyDeals([item('a', 20), item('b', 20), item('c', 20)], [third]);
    const shares = r.discounts.map((d) => d!.amount);
    expect(shares).toEqual([3.33, 3.33, 3.34]);
    expect(shares.reduce((s, n) => s + n, 0)).toBeCloseTo(10, 10);
  });

  it('a class picked twice (a crafted request) only counts once', () => {
    expect(applyDeals([item('intro', 25), item('intro', 25)], [zouk]).totalDiscount).toBe(0);
  });
});

describe('suggesting a class to complete a deal', () => {
  it('offers the missing class with what it saves', () => {
    expect(suggestDeals([item('intro', 25)], [zouk], [{ key: 'open', price: 25 }])).toEqual([
      { dealId: 'z', dealName: 'Zouk Pop-Up Bundle', key: 'open', saving: 10 },
    ]);
  });

  it('offers nothing when the deal is already applied, unrelated, or two classes away', () => {
    expect(suggestDeals([item('intro', 25), item('open', 25)], [zouk], [{ key: 'open', price: 25 }])).toEqual([]);
    expect(suggestDeals([item('other', 25)], [zouk], [{ key: 'open', price: 25 }])).toEqual([]);
    const three: Deal = { ...zouk, seriesKeys: ['intro', 'open', 'third'] };
    expect(suggestDeals([item('intro', 25)], [three], [{ key: 'open', price: 25 }, { key: 'third', price: 25 }])).toEqual([]);
  });
});

it('summarizes a deal', () => {
  expect(dealSummary(zouk, 2)).toBe('Both for $40');
  expect(dealSummary({ kind: 'percent_off', amount: 20, requiredCount: 3 }, 6)).toBe('20% off any 3');
  expect(dealSummary({ kind: 'amount_off', amount: 7.5, requiredCount: null }, 3)).toBe('$7.50 off all 3');
});
