import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { lookbackCutoffIso } from '../../../lib/deletionAudit';

export const prerender = false;

interface Dancer {
  firstName?: string;
  lastName?: string;
}

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const { data, error } = await supabase
    .from('deletion_audit')
    .select('id, deleted_at, deleted_by, action, record_id, dancer_index, snapshot')
    .eq('table_name', 'intake_submissions')
    .gte('deleted_at', lookbackCutoffIso())
    .order('deleted_at', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to load deleted sign-ups.' }), { status: 500 });
  }

  const entries = (data ?? []).map((row) => {
    const snapshot = row.snapshot as Record<string, unknown>;
    const dancers = Array.isArray(snapshot.dancers) ? (snapshot.dancers as Dancer[]) : null;
    const removedDancer = row.action === 'remove_dancer' && dancers && row.dancer_index != null ? dancers[row.dancer_index] : null;

    return {
      auditId: row.id,
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
      action: row.action,
      submissionId: row.record_id,
      dancerIndex: row.dancer_index,
      firstName: removedDancer?.firstName ?? (snapshot.first_name as string) ?? '',
      lastName: removedDancer?.lastName ?? (snapshot.last_name as string) ?? '',
      class: (snapshot.class as string | null) ?? null,
    };
  });

  return new Response(JSON.stringify({ entries }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
