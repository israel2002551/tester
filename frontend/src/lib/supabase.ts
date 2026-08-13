import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Supabase publishable keys are safe for browser use; RLS remains the security boundary.
// Environment variables take precedence so deployments can rotate/configure the project without code changes.
const url = import.meta.env.VITE_SUPABASE_URL?.trim() || 'https://obzhlmzswthnorkiqemh.supabase.co';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || 'sb_publishable_azaL_h8WuH9uM-jDR3qq8A_SwFBW8tr';

export const supabase: SupabaseClient = createClient(url, publishableKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
