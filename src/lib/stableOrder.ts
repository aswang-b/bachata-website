// Browser-safe, no DOM. Keeps a dashboard table's rows where the admin is
// looking at them. A table re-sorts and re-filters only when asked to (its
// first draw, a sort header, its search or filter); any other redraw (a Paid
// switch, a saved edit, the lock taken or let go, a reload of the data) keeps
// the rows already shown in their places, with their new values, even ones
// that no longer match the filter. Rows gone from the data drop out, and
// brand-new ones (a sign-up just added) go first, where the add row was.
// A row is one dancer (or check-in), so the lines drawn under it (a dancer's
// other classes) always move with it.

export interface StableOrder<T> {
  /** The rows to draw: `sorted` (the table's rows, filtered and sorted) when re-sorting; otherwise the rows shown last time, in that order, taken fresh from `all` (the table's whole data), after any new ones from `sorted`. */
  rows<R extends T>(sorted: R[], all: readonly R[]): R[];
  /** The next `rows` re-sorts and re-filters. */
  resort(): void;
  /** `draw`, re-sorting: for a sort header, a search box or a filter. */
  resorting(draw: () => void): () => void;
}

export function stableOrder<T>(keyOf: (row: T) => string): StableOrder<T> {
  // The keys drawn last time, in order (null: re-sort next time), and every key the data had then.
  let shown: string[] | null = null;
  let known = new Set<string>();

  const resort = () => {
    shown = null;
  };

  return {
    rows<R extends T>(sorted: R[], all: readonly R[]): R[] {
      const byKey = new Map(all.map((row) => [keyOf(row), row] as const));
      let result = sorted;
      if (shown) {
        const kept = shown.flatMap((key) => (byKey.has(key) ? [byKey.get(key)!] : []));
        const fresh = sorted.filter((row) => !known.has(keyOf(row)));
        result = [...fresh, ...kept];
      }
      shown = result.map(keyOf);
      known = new Set(byKey.keys());
      return result;
    },
    resort,
    resorting: (draw) => () => {
      resort();
      draw();
    },
  };
}
