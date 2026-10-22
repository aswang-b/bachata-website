import { supabase } from './supabase';

// Contact form messages (the contact_messages table, migration 0049), kept
// apart from class/event sign-ups. Read by the admin inbox and
// /contact/confirmation.

export interface ContactMessageInput {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  instagram: string | null;
  whatsapp: string | null;
  message: string | null;
}

// The same message sent twice within this window (double-click, back and
// resubmit) is saved once.
const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
const fingerprint = (m: Record<string, string | null>) =>
  [m.first_name, m.last_name, m.email, m.phone, m.instagram, m.whatsapp, m.message].map(norm).join('#');

// Saves a message, or finds the identical one just sent. `duplicateOf` is
// that earlier message's id (nothing new is saved, and no second email should
// go out). null on a database failure.
export async function saveContactMessage(input: ContactMessageInput): Promise<{ id: string; duplicateOf: string | null } | null> {
  const row = {
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone,
    instagram: input.instagram,
    whatsapp: input.whatsapp,
    message: input.message,
  };

  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
  const { data: recent, error: recentError } = await supabase
    .from('contact_messages')
    .select('id, first_name, last_name, email, phone, instagram, whatsapp, message')
    .is('deleted_at', null)
    .ilike('first_name', input.firstName)
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (recentError) console.error('Duplicate contact message check failed:', recentError.message);
  const original = (recent ?? []).find((m) => fingerprint(m) === fingerprint(row));
  if (original) return { id: original.id, duplicateOf: original.id };

  const { data, error } = await supabase.from('contact_messages').insert(row).select('id').single();
  if (error || !data) {
    console.error('Failed to save contact message:', error);
    return null;
  }
  return { id: data.id, duplicateOf: null };
}
