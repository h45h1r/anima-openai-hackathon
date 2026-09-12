import type { NextConfig } from 'next';

const API_ORIGIN = process.env.CARE_CIRCLE_API_ORIGIN || 'http://localhost:8787';

const nextConfig: NextConfig = {
  // Proxy API to Express so the browser never holds the Anima key (same-origin /api).
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
