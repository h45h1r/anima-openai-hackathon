import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Clinical Ask runs in-process under /api/care — no Express proxy.
  serverExternalPackages: ["@animahealth/adk"],
};

export default nextConfig;
