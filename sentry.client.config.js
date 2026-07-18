/**
 * sentry.client.config.js — Sentry init for the browser bundle.
 *
 * Loaded automatically by the webpack config `withSentryConfig` (in
 * next.config.js) injects — see the Sentry docs for the Next.js Pages
 * Router / hybrid setup. Error capture only: low trace sample rate, no
 * session replay.
 */
import * as Sentry from '@sentry/nextjs';
import { resolveSentryEnvironment } from './lib/sentryEnvironment';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: resolveSentryEnvironment(),

  // Soft launch, small user base — capture errors, not full performance
  // tracing. Kept low rather than 0 so we still have some latency signal
  // if a real problem shows up.
  tracesSampleRate: 0.1,

  // No session replay, no error-report dialog — this is error capture only.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Explicit, not relied-upon-as-default: no IP addresses, headers, or
  // request bodies auto-attached to events. Ingredient lists, emails, and
  // other free-text/PII fields are never passed to Sentry regardless — see
  // the per-call-site scrubbing this project applies before any
  // Sentry.captureException/captureMessage call.
  sendDefaultPii: false,
});
