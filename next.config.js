/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Rewrite the root URL to serve the full prototype.
   * The URL stays as "/" in the browser — no redirect hop.
   * The test page is still accessible at /stack-test.
   */
  async rewrites() {
    return [
      { source: '/', destination: '/prototype.html' },
    ];
  },
};

module.exports = nextConfig;
