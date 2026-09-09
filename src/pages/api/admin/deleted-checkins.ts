import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/supabase';
import { requireAdmin } from '../../../lib/admin';
import { lookbackCutoffIso } from '../../../lib/deletionAudit';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const { user, error: authError } = await requireAdmin(request);
  if (!user) {
    return new Response(JSON.stringify({ error: authError }), { status: 403 });
  }

  const { data, error } = await supabase
    .from('deletion_audit')
    .select('id, deleted_at, deleted_by, record_id, snapshot')
    .eq('table_name', 'class_checkins')
    .gte('deleted_at', lookbackCutoffIso())
    .order('deleted_at', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: 'Failed to load deleted check-ins.' }), { status: 500 });
  }

  const entries = (data ?? []).map((row) => {
    const snapshot = row.snapshot as Record<string, unknown>;
    return {
      auditId: row.id,
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
      checkinId: row.record_id,
      firstName: (snapshot.first_name as string) ?? '',
      lastName: (snapshot.last_name as string) ?? '',
      classTitle: (snapshot.class_title as string | null) ?? null,
    };
  });

  return new Response(JSON.stringify({ entries }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
