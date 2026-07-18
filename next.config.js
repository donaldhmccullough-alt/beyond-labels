const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // pages/api routes coexist with App Router
  // Prevent Supabase realtime WebSocket from being bundled server-side (Next.js 14 key)
  experimental: {
    serverComponentsExternalPackages: ['@supabase/realtime-js'],
    // Required on Next.js 14 (stable by default starting Next.js 15) so the
    // root instrumentation.js hook — which registers Sentry's server/edge
    // config — actually runs. See instrumentation.js for what it loads.
    instrumentationHook: true,
  },
  env: {
    // Mirrors the server-only VERCEL_ENV ('production' | 'preview' |
    // 'development') into the client bundle so sentry.client.config.js can
    // tell a Vercel preview deploy apart from real production traffic —
    // see lib/sentryEnvironment.js.
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV,
  },
};

// withSentryConfig wraps the Next.js config to upload source maps and wire
// up Sentry's build-time instrumentation (e.g. wrapping API routes so an
// uncaught throw is still reported even if a route has no Sentry call of
// its own). org/project/authToken are only needed for source map upload —
// left undefined until SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN are set;
// the plugin no-ops that step (not the build) when they're absent.
module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Silence the Sentry build-plugin's own console output (webpack build
  // logs stay clean); this does not affect what gets captured at runtime.
  silent: true,
  // No user-facing widget for our own errors — we watch the Sentry
  // dashboard directly, not a client-side report dialog.
  widenClientFileUpload: false,
});
