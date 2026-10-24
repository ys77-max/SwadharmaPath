import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** true when the UI runs on in-memory demo data instead of Supabase. */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true' || !url || !anonKey

if (!DEMO_MODE && import.meta.env.PROD && (!url || !anonKey)) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set')
}

// Only the anon key ships to the browser. Every read and write is governed by
// the RLS policies in supabase/migrations/001_init.sql.
export const supabase: SupabaseClient = createClient(url ?? 'http://localhost:54321', anonKey ?? 'demo-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
