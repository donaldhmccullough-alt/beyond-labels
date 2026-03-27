/** @type {import('next').NextConfig} */
const nextConfig = {
  // pages/api routes coexist with App Router
  // Prevent Supabase realtime WebSocket from being bundled server-side (Next.js 14 key)
  experimental: {
    serverComponentsExternalPackages: ['@supabase/realtime-js'],
  },
};

module.exports = nextConfig;
