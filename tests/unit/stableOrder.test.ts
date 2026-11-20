import { describe, expect, it } from 'vitest';
import { stableOrder } from '../../src/lib/stableOrder';

// The dashboard tables keep the order the admin is looking at through edits
// and reloads: toggling Paid with the table sorted by Paid used to send the row
// straight to its new place (or out of a filtered view).
interface Row {
  id: string;
  name: string;
  paid: boolean;
}

const row = (id: string, paid = false, name = id): Row => ({ id, name, paid });
const byPaid = (rows: Row[]) => [...rows].sort((a, b) => Number(a.paid) - Number(b.paid) || a.name.localeCompare(b.name));
const ids = (rows: Row[]) => rows.map((r) => r.id);

describe('stableOrder', () => {
  it('draws the sorted rows the first time, and again after resort()', () => {
    const order = stableOrder((r: Row) => r.id);
    const all = [row('b', true), row('a'), row('c')];
    expect(ids(order.rows(byPaid(all), all))).toEqual(['a', 'c', 'b']);
    all[0].paid = false;
    order.resort();
    expect(ids(order.rows(byPaid(all), all))).toEqual(['a', 'b', 'c']);
  });

  it('keeps a row in its place when its value changes, with the new value', () => {
    const order = stableOrder((r: Row) => r.id);
    let all = [row('a'), row('b'), row('c')];
    order.rows(byPaid(all), all);
    // A reload brings new objects, with a's Paid switched on.
    all = [row('a', true), row('b'), row('c')];
    const drawn = order.rows(byPaid(all), all);
    expect(ids(drawn)).toEqual(['a', 'b', 'c']);
    expect(drawn[0]).toBe(all[0]);
    expect(drawn[0].paid).toBe(true);
    // Until the admin sorts again.
    order.resort();
    expect(ids(order.rows(byPaid(all), all))).toEqual(['b', 'c', 'a']);
  });

  it('drops a row deleted from the data', () => {
    const order = stableOrder((r: Row) => r.id);
    const all = [row('a'), row('b'), row('c')];
    order.rows(byPaid(all), all);
    const left = all.filter((r) => r.id !== 'b');
    expect(ids(order.rows(byPaid(left), left))).toEqual(['a', 'c']);
  });

  it('puts a brand-new row first without moving the rest', () => {
    const order = stableOrder((r: Row) => r.id);
    const all = [row('b'), row('c', true)];
    order.rows(byPaid(all), all);
    all[0].paid = true;
    const more = [...all, row('a'), row('d', true)];
    // New rows go first (in their sorted order), the rest stay where they were.
    expect(ids(order.rows(byPaid(more), more))).toEqual(['a', 'd', 'b', 'c']);
    // And they keep that place after.
    expect(ids(order.rows(byPaid(more), more))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('keeps a shown row that no longer matches the filter until a resort, and leaves out hidden ones that start matching', () => {
    const order = stableOrder((r: Row) => r.id);
    const all = [row('a'), row('b'), row('c', true)];
    const unpaid = () => byPaid(all.filter((r) => !r.paid));
    expect(ids(order.rows(unpaid(), all))).toEqual(['a', 'b']);
    all[0].paid = true;
    all[2].paid = false;
    expect(ids(order.rows(unpaid(), all))).toEqual(['a', 'b']);
    order.resort();
    expect(ids(order.rows(unpaid(), all))).toEqual(['b', 'c']);
  });

  it('a new row that the filter leaves out stays out', () => {
    const order = stableOrder((r: Row) => r.id);
    const all = [row('a')];
    const unpaid = () => byPaid(all.filter((r) => !r.paid));
    order.rows(unpaid(), all);
    all.push(row('z', true));
    expect(ids(order.rows(unpaid(), all))).toEqual(['a']);
  });

  it('an empty first draw (before the data loads) still sorts the rows that arrive', () => {
    const order = stableOrder((r: Row) => r.id);
    order.rows([], []);
    const all = [row('b', true), row('a'), row('c')];
    expect(ids(order.rows(byPaid(all), all))).toEqual(['a', 'c', 'b']);
  });

  it('resorting() re-sorts on the draw it wraps', () => {
    const order = stableOrder((r: Row) => r.id);
    const all = [row('a'), row('b')];
    let drawn: string[] = [];
    const draw = () => (drawn = ids(order.rows(byPaid(all), all)));
    draw();
    all[0].paid = true;
    draw();
    expect(drawn).toEqual(['a', 'b']);
    order.resorting(draw)();
    expect(drawn).toEqual(['b', 'a']);
  });
});
