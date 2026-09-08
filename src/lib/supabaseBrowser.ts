import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY.');
}

// Browser-only client using the anon key — safe to expose, unlike the
// service role key used in src/lib/supabase.ts.
export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey);
