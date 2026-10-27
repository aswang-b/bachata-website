// A small in-memory stand-in for the Supabase client, covering the query
// builder calls the server modules use. Tables are plain arrays of rows;
// every query is recorded so tests can assert what was (or wasn't) called.

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export interface RecordedCall {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  payload?: unknown;
}

export interface FakeError {
  code?: string;
  message: string;
}

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  calls: RecordedCall[] = [];
  // Force an error for the next matching operation: `${table}.${op}` → error.
  failNext = new Map<string, FakeError>();
  rpcHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {};
  // Run once just before the next matching operation: `${table}.${op}` → callback
  // (e.g. another admin's write landing between a read and a write).
  beforeNext = new Map<string, () => void>();
  private nextId = 1;

  seed(table: string, rows: Row[]): this {
    this.tables[table] = rows.map((r) => ({ ...r }));
    return this;
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  callsTo(table: string, op?: RecordedCall['op']): RecordedCall[] {
    return this.calls.filter((c) => c.table === table && (!op || c.op === op));
  }

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  async rpc(name: string, args: Record<string, unknown>) {
    const handler = this.rpcHandlers[name];
    if (!handler) return { data: null, error: { message: `no rpc ${name}` } };
    // A handler throws a { message, details?, code? } object to answer with a database error.
    try {
      return { data: handler(args), error: null };
    } catch (err) {
      return { data: null, error: err as FakeError & { details?: string } };
    }
  }

  takeFailure(table: string, op: string): FakeError | undefined {
    const key = `${table}.${op}`;
    const err = this.failNext.get(key);
    if (err) this.failNext.delete(key);
    return err;
  }

  newId(): string {
    return `fake-${this.nextId++}`;
  }
}

const cmp = (a: unknown, b: unknown) => {
  const as = String(a);
  const bs = String(b);
  // Compare ISO timestamps as instants, everything else as strings/numbers.
  const at = Date.parse(as);
  const bt = Date.parse(bs);
  if (!Number.isNaN(at) && !Number.isNaN(bt) && /\d{4}-\d{2}-\d{2}/.test(as)) return at - bt;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return as < bs ? -1 : as > bs ? 1 : 0;
};

class QueryBuilder implements PromiseLike<{ data: unknown; error: FakeError | null }> {
  private filters: Filter[] = [];
  private op: RecordedCall['op'] = 'select';
  private payload: unknown;
  private singleMode: 'one' | 'maybe' | null = null;
  private returnRows = false;
  private orderBy: { col: string; asc: boolean }[] = [];
  private limitN: number | null = null;

  constructor(
    private db: FakeSupabase,
    private table: string
  ) {}

  select(_cols?: string) {
    if (this.op !== 'select') this.returnRows = true;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  upsert(payload: Row | Row[]) {
    this.op = 'upsert';
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(col: string, v: unknown) {
    // A JSON column compared with a JSON string, as PostgREST compares jsonb.
    this.filters.push((r) => (r[col] !== null && typeof r[col] === 'object' && typeof v === 'string' ? JSON.stringify(r[col]) === JSON.stringify(JSON.parse(v)) : r[col] === v));
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  not(col: string, op: string, v: unknown) {
    if (op === 'is') this.filters.push((r) => (r[col] ?? null) !== v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  gte(col: string, v: unknown) {
    this.filters.push((r) => r[col] != null && cmp(r[col], v) >= 0);
    return this;
  }
  gt(col: string, v: unknown) {
    this.filters.push((r) => r[col] != null && cmp(r[col], v) > 0);
    return this;
  }
  lte(col: string, v: unknown) {
    this.filters.push((r) => r[col] != null && cmp(r[col], v) <= 0);
    return this;
  }
  lt(col: string, v: unknown) {
    this.filters.push((r) => r[col] != null && cmp(r[col], v) < 0);
    return this;
  }
  // Supports the "a.not.is.null,b.eq.true" form used in this codebase.
  or(expr: string) {
    const parts = expr.split(',').map((p) => p.split('.'));
    this.filters.push((r) =>
      parts.some(([col, a, b, c]) => {
        if (a === 'not' && b === 'is' && c === 'null') return r[col] != null;
        if (a === 'eq') return String(r[col]) === b;
        return false;
      })
    );
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy.push({ col, asc: opts.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.limitN = to - from + 1;
    return this;
  }
  maybeSingle() {
    this.singleMode = 'maybe';
    return this;
  }
  single() {
    this.singleMode = 'one';
    return this;
  }

  then<T1 = { data: unknown; error: FakeError | null }, T2 = never>(
    onfulfilled?: ((value: { data: unknown; error: FakeError | null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private matches(row: Row) {
    return this.filters.every((f) => f(row));
  }

  private execute(): { data: unknown; error: FakeError | null } {
    const key = `${this.table}.${this.op}`;
    const before = this.db.beforeNext.get(key);
    if (before) {
      this.db.beforeNext.delete(key);
      before();
    }
    this.db.calls.push({ table: this.table, op: this.op, payload: this.payload });
    const failure = this.db.takeFailure(this.table, this.op);
    if (failure) return { data: null, error: failure };
    const rows = this.db.rows(this.table);

    let out: Row[];
    switch (this.op) {
      case 'insert':
      case 'upsert': {
        const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        out = incoming.map((r) => {
          const existing = this.op === 'upsert' && r.id !== undefined ? rows.find((x) => x.id === r.id) : undefined;
          if (existing) return Object.assign(existing, r);
          const row = { id: this.db.newId(), created_at: new Date().toISOString(), ...r };
          rows.push(row);
          return row;
        });
        break;
      }
      case 'update':
        out = rows.filter((r) => this.matches(r));
        out.forEach((r) => Object.assign(r, this.payload));
        break;
      case 'delete':
        out = rows.filter((r) => this.matches(r));
        this.db.tables[this.table] = rows.filter((r) => !out.includes(r));
        break;
      default:
        out = rows.filter((r) => this.matches(r));
    }

    for (const { col, asc } of [...this.orderBy].reverse()) {
      out = [...out].sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]));
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);

    const copy = out.map((r) => ({ ...r }));
    if (this.singleMode) {
      if (copy.length === 0) return this.singleMode === 'maybe' ? { data: null, error: null } : { data: null, error: { message: 'no rows' } };
      return { data: copy[0], error: null };
    }
    if (this.op !== 'select' && !this.returnRows) return { data: null, error: null };
    return { data: copy, error: null };
  }
}
