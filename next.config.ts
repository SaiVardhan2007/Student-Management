// Next.js settings: security headers (Content-Security-Policy etc.) and server build options.
import type { NextConfig } from 'next';

// Razorpay Checkout loads its script from checkout.razorpay.com and runs inside an iframe from api.razorpay.com.
// Next.js needs inline bootstrap scripts (and eval for hot reload in development); everything else stays same-origin.
const isDev = process.env.NODE_ENV !== 'production';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://checkout.razorpay.com${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.razorpay.com",
  "font-src 'self' data:",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  `connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com${isDev ? ' ws: wss:' : ''}`,
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self' https://api.razorpay.com",
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // native / fs-reading packages must not be bundled into route handlers
  serverExternalPackages: ['mongoose', 'bcryptjs', 'pdfkit', 'csv-parse'],
  experimental: {
    // uploads go through route handlers; keep the same 10 MB cap as before (plus multipart overhead)
    proxyClientMaxBodySize: '12mb',
    // reuse visited pages from the client router cache instead of asking the server again on every click
    staleTimes: { dynamic: 60, static: 300 },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
