import { supabase } from './supabase';
import { env } from './env';

const ADMIN_EMAIL = env('ADMIN_EMAIL');

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!ADMIN_EMAIL || !email) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL.trim().toLowerCase();
}

/**
 * Verifies the Supabase access token from an Authorization: Bearer header
 * and confirms the associated user's email matches ADMIN_EMAIL. Used to
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
