import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Without this, Turbopack walks up and picks /Users/<you>/package-lock.json
  // as the workspace root and warns on every start.
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  experimental: {
    serverActions: {
      // MarkOS runs locally only; the old Vercel origin is gone.
      allowedOrigins: ['localhost:3001'],
    },
  },
}

export default nextConfig
