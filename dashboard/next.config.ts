import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/landing.html" },
      ],
      afterFiles: [
        { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
        { source: "/ws/:path*", destination: `${apiUrl}/ws/:path*` },
      ],
      fallback: [],
    };
  },
};

export default nextConfig;
