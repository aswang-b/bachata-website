// Supabase caps one response at 1000 rows, so a table that grows is read a
// page at a time. The query must be ordered by something unique (add `id`
// last) so pages never overlap or skip a row.

const PAGE_SIZE = 1000;
// Ids per `.in()` filter, so the request URL stays well under its limit.
const IDS_PER_QUERY = 100;

// Rows come back as whatever the caller says they are (the type parameter).
type Page = PromiseLike<{ data: unknown; error: { message: string } | null }>;

export async function fetchAllRows<T>(page: (from: number, to: number) => Page): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE_SIZE) return rows;
  }
}

// Every row matching any of `ids`, a chunk of ids per query.
export async function fetchAllIn<T>(ids: string[], page: (ids: string[], from: number, to: number) => Page): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_QUERY) chunks.push(ids.slice(i, i + IDS_PER_QUERY));
  const results = await Promise.all(chunks.map((chunk) => fetchAllRows<T>((from, to) => page(chunk, from, to))));
  return results.flat();
}
