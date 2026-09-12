import type { NextConfig } from "next";

const CARE_API_ORIGIN = process.env.CARE_CIRCLE_API_ORIGIN || "http://localhost:8787";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/care-api/:path*",
        destination: `${CARE_API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
