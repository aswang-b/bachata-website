// Pure (client-safe). Each dancer on a group sign-up has their own Paid:
// `dancers[i].paid`. Sign-ups saved before that (or never changed since) have
// only the sign-up's own `paid`, which every dancer without a flag reads, so
// old data shows exactly as it did. A sign-up with no dancers list (one
// person) keeps using the sign-up's `paid`.

type DancerJson = Record<string, unknown>;

const isDeleted = (d: unknown) => Boolean(d && typeof d === 'object' && (d as DancerJson).deleted);

// A dancer's Paid: their own flag when they have one, else the sign-up's.
export function dancerPaid(dancer: unknown, submissionPaid: boolean): boolean {
  const own = dancer && typeof dancer === 'object' ? (dancer as DancerJson).paid : undefined;
  return typeof own === 'boolean' ? own : Boolean(submissionPaid);
}

export type DancerPaidChange =
  // `dancers` null: only the sign-up's own `paid` is written.
  | { ok: true; dancers: DancerJson[] | null; paid: boolean }
  | { ok: false; error: 'missing-index' | 'not-found' };

// Sets one dancer's Paid (`dancerIndex` null for a one-person sign-up). Every
// dancer without a flag first gets the sign-up's current value, so changing
// one never changes how the others read; the sign-up's `paid` then says
// whether every live dancer (not in the Recycling Bin) has paid.
export function withDancerPaid(dancers: unknown, submissionPaid: boolean, dancerIndex: number | null, paid: boolean): DancerPaidChange {
  const list = Array.isArray(dancers) ? (dancers as unknown[]) : null;
  const hasLive = Boolean(list?.some((d) => !isDeleted(d)));
  if (dancerIndex == null) return hasLive ? { ok: false, error: 'missing-index' } : { ok: true, dancers: null, paid };
  if (!list || !Number.isInteger(dancerIndex) || dancerIndex < 0 || dancerIndex >= list.length || isDeleted(list[dancerIndex])) {
    return { ok: false, error: 'not-found' };
  }
  const next = list.map((d, i): DancerJson => {
    const own = { ...(d && typeof d === 'object' ? (d as DancerJson) : {}) };
    own.paid = i === dancerIndex ? paid : dancerPaid(d, submissionPaid);
    return own;
  });
  return { ok: true, dancers: next, paid: next.filter((d) => !isDeleted(d)).every((d) => d.paid === true) };
}

// After a dancer's Paid is saved: only that dancer's row changes.
export function markRowPaid<T extends { submissionId: string; dancerIndex: number | null; paid: boolean }>(
  rows: T[],
  submissionId: string,
  dancerIndex: number | null,
  paid: boolean
): void {
  for (const r of rows) if (r.submissionId === submissionId && (r.dancerIndex ?? null) === dancerIndex) r.paid = paid;
}
