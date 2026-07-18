/**
 * lib/sentryEnvironment.js — shared Sentry `environment` tag resolution.
 *
 * Imported by sentry.client.config.js, sentry.server.config.js, and
 * sentry.edge.config.js so all three compute the same value the same way —
 * a single source of truth, same reasoning as lib/cacheVersion.js's
 * PROMPT_VERSION.
 *
 * VERCEL_ENV ('production' | 'preview' | 'development') is only set on
 * Vercel and only visible server-side by default; NEXT_PUBLIC_VERCEL_ENV is
 * the client-visible mirror of it, wired in next.config.js's `env` block.
 * Locally (no Vercel env at all — including Claude Code's own
 * live-verification runs against `next dev`/`next build && next start`),
 * this falls back to NODE_ENV, which Next.js always sets appropriately.
 */
export function resolveSentryEnvironment() {
  const vercelEnv = process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv) return vercelEnv;
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}
