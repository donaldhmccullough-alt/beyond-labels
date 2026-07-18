/**
 * sentry.edge.config.js — Sentry init for the Edge runtime (middleware,
 * edge API routes). This project doesn't currently use either, but Next.js
 * calls this file's register() path unconditionally when instrumentation
 * is enabled, so it needs a valid init the same as client/server.
 *
 * Loaded by instrumentation.js's register() hook when NEXT_RUNTIME==='edge'.
 */
import * as Sentry from '@sentry/nextjs';
import { resolveSentryEnvironment } from './lib/sentryEnvironment';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: resolveSentryEnvironment(),
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
