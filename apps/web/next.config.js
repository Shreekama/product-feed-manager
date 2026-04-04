/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',      // builds to apps/web/out/ — served by the Worker
  trailingSlash: true,   // required for static export + Cloudflare assets routing
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '/api',
  },
};

module.exports = nextConfig;
