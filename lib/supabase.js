import { createClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function makeClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    // No env vars — run in localStorage-only mode (anonymous users)
    if (typeof window !== 'undefined') {
      console.info('Beyond Labels: Supabase not configured — running in offline mode.');
    }
    return null;
  }
  try {
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  } catch (err) {
    console.error('Beyond Labels: Supabase client init failed:', err.message);
    Sentry.captureException(err, {
      tags: { route: 'lib/supabase', op: 'client_init' },
    });
    return null;
  }
}

export const supabase = makeClient();
