import { supabase } from './supabase';
import { env } from './env';

// Comma-separated list — ADMIN_EMAIL=alice@example.com,bob@example.com.
// A single address still works fine as a list of one.
const ADMIN_EMAILS = (env('ADMIN_EMAIL') ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email || ADMIN_EMAILS.length === 0) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * Verifies the Supabase access token from an Authorization: Bearer header
 * and confirms the associated user's email is in ADMIN_EMAIL. Used to
 * gate admin-only API routes without full SSR session/cookie plumbing.
 */
export async function requireAdmin(request: Request) {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  if (!token) {
    return { user: null, error: 'Missing Authorization header.' };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return { user: null, error: 'Invalid or expired session.' };
  }

  if (!isAdminEmail(data.user.email)) {
    return { user: null, error: 'Not authorized.' };
  }

  return { user: data.user, error: null };
}
