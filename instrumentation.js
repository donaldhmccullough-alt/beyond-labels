/**
 * instrumentation.js — Next.js instrumentation hook (root-level, required
 * file name/location). Enabled via experimental.instrumentationHook in
 * next.config.js (stable-by-default starting Next.js 15; this project pins
 * Next.js 14, so the flag is explicit).
 *
 * Next.js calls register() once per server runtime at boot. This is what
 * actually loads sentry.server.config.js / sentry.edge.config.js — those
 * files are never imported directly by anything else.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
