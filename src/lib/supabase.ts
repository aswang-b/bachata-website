import { createClient } from '@supabase/supabase-js';
import { env } from './env';

const supabaseUrl = env('SUPABASE_URL');
const supabaseServiceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env (local) or the hosting environment variables on Netlify/Vercel (production).'
  );
}

// Server-only client: uses the service role key, so it must never be imported
// from client-side code or exposed to the browser.
export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
