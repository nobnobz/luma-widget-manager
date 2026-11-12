import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath,
  ...(process.platform === 'darwin' && { experimental: { cpus: 2 } }),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
