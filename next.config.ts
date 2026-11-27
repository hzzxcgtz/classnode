import type { NextConfig } from "next";

import { classroomCameraPolicy, classroomMicrophonePolicy } from './server/src/services/external-webapp-policy';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  ...(process.env.NODE_ENV === 'development' ? {
    async headers() {
      return [
        { source: '/:path*', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] },
        { source: '/classroom', headers: [{ key: 'Permissions-Policy',
          value: `camera=${classroomCameraPolicy('/classroom')}, microphone=${classroomMicrophonePolicy('/classroom')}, geolocation=()` }] },
      ];
    },
  } : {}),
};

export default nextConfig;
