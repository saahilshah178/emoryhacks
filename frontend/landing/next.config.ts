import type { NextConfig } from "next";

// The API (FastAPI, see backend/) is reached through this app's own origin: the browser
// calls /api/..., and Next forwards it. One origin means the session cookie, video
// seeking and uploads need no cross-origin setup.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
  experimental: {
    // Uploading and converting a long recording can take minutes.
    proxyTimeout: 600_000,
    // Next buffers a forwarded request body and cuts it off at 10 MB by default, which
    // stalls the upload of any recording longer than about half a minute. This limit
    // sits just above the API's own limit (300 MB, MAX_UPLOAD_MB in backend/app/config.py),
    // so it is the API that answers, with a readable message, when a file really is too large.
    proxyClientMaxBodySize: "320mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
