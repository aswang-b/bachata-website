import { supabase } from './supabase';

// Sign-ups that use a bounced email address, listed on the dashboard's Errors
// workqueue (api/admin/site-errors.ts).

// A sign-up (and which of its dancers) whose email is the bounced address.
export interface BounceMatch {
  submissionId: string;
  dancerIndex: number | null;
  name: string;
  email: string;
  registrationType: string;
  createdAt: string;
}

const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function signupsWithEmail(email: string): Promise<BounceMatch[]> {
  const [regs, subs, inDancers] = await Promise.all([
    supabase.from('class_registrations').select('submission_id, dancer_index').ilike('email', likeExact(email)).is('deleted_at', null),
    supabase.from('intake_submissions').select('id').ilike('email', likeExact(email)).is('deleted_at', null),
    // A dancer whose address is only in the sign-up's dancer list.
    supabase.from('intake_submissions').select('id, dancers').filter('dancers', 'cs', JSON.stringify([{ email }])).is('deleted_at', null),
  ]);
  const pairs = new Map<string, { submissionId: string; dancerIndex: number | null }>();
  for (const r of regs.data ?? []) pairs.set(`${r.submission_id}|${r.dancer_index}`, { submissionId: r.submission_id, dancerIndex: r.dancer_index });
  for (const s of inDancers.data ?? []) {
    (Array.isArray(s.dancers) ? (s.dancers as Record<string, string>[]) : []).forEach((d, i) => {
      if ((d.email ?? '').toLowerCase() === email.toLowerCase()) pairs.set(`${s.id}|${i}`, { submissionId: s.id, dancerIndex: i });
    });
  }
  for (const s of subs.data ?? []) if (![...pairs.values()].some((p) => p.submissionId === s.id)) pairs.set(`${s.id}|`, { submissionId: s.id, dancerIndex: null });
  const ids = [...new Set([...pairs.values()].map((p) => p.submissionId))];
  if (ids.length === 0) return [];
  const { data } = await supabase.from('intake_submissions').select('id, registration_type, first_name, last_name, email, dancers, created_at').in('id', ids).is('deleted_at', null);
  const byId = new Map((data ?? []).map((s) => [s.id, s]));
  return [...pairs.values()].flatMap((p) => {
    const s = byId.get(p.submissionId);
    if (!s) return [];
    const dancer = p.dancerIndex != null && Array.isArray(s.dancers) ? (s.dancers as Record<string, string>[])[p.dancerIndex] : null;
    return [
      {
        submissionId: s.id,
        dancerIndex: p.dancerIndex,
        name: dancer ? `${dancer.firstName ?? ''} ${dancer.lastName ?? ''}`.trim() : `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim(),
        email: dancer?.email ?? s.email ?? '',
        registrationType: s.registration_type,
        createdAt: s.created_at,
      },
    ];
  });
}
