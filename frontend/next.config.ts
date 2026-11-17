import type { NextConfig } from "next";

const backendTarget = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  experimental: {
    // Rewrites to the API default to 30s. Reference uploads (Onion assets, canvas media) take longer.
    proxyTimeout: 300_000,
  },
  async rewrites() {
    return [
      {
        source: "/api-proxy/:path*",
        destination: `${backendTarget.replace(/\/$/, "")}/:path*`
      }
    ];
  }
};

export default nextConfig;
