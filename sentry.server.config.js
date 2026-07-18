/**
 * sentry.server.config.js — Sentry init for the Node.js server runtime
 * (API routes under pages/api/, and App Router server rendering).
 *
 * Loaded by instrumentation.js's register() hook when NEXT_RUNTIME==='nodejs'.
 */
import * as Sentry from '@sentry/nextjs';
import { resolveSentryEnvironment } from './lib/sentryEnvironment';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: resolveSentryEnvironment(),

  // Soft launch, small user base — error capture, not full performance
  // tracing.
  tracesSampleRate: 0.1,

  // No IP addresses, headers, or request bodies auto-captured. Every
  // Sentry call site in this codebase scrubs ingredient lists, emails, and
  // other free-text/PII fields before calling captureException/captureMessage.
  sendDefaultPii: false,
});
