import { supabase } from './supabase';

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface RecordDeletionInput {
  deletedBy: string;
  tableName: string;
  action: string;
  recordId: string;
  dancerIndex?: number | null;
  snapshot: unknown;
}

// Snapshots a row before it's deleted (or before a dancer is removed from a
// still-existing submission), so an accidental delete in /admin/analytics
// can be reviewed and restored. Self-pruning: every write also clears out
// anything older than the 7-day lookback, so this table never needs a cron
// job and never grows unbounded. Failures here are logged but never block
// the deletion itself — the audit trail is a convenience, not a guarantee.
export async function recordDeletion(input: RecordDeletionInput): Promise<void> {
  try {
    await supabase.from('deletion_audit').insert({
      deleted_by: input.deletedBy,
      table_name: input.tableName,
      action: input.action,
      record_id: input.recordId,
      dancer_index: input.dancerIndex ?? null,
      snapshot: input.snapshot,
    });
  } catch (err) {
    console.error('Failed to record deletion audit entry:', err);
  }

  try {
    await supabase.from('deletion_audit').delete().lt('deleted_at', new Date(Date.now() - LOOKBACK_MS).toISOString());
  } catch (err) {
    console.error('Failed to prune old deletion audit entries:', err);
  }
}

export function lookbackCutoffIso(): string {
  return new Date(Date.now() - LOOKBACK_MS).toISOString();
}
