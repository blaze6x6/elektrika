import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Next.js za hidracijo potrebuje inline skripte, zato 'unsafe-inline'.
// (Strožji CSP z nonce bi zahteval dinamično upodabljanje vseh strani.)
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...(isProd
    ? [
        { key: "Content-Security-Policy", value: csp },
        // HSTS brskalniki upoštevajo samo prek HTTPS, prek HTTP je neškodljiv
        { key: "Strict-Transport-Security", value: "max-age=15552000" },
      ]
    : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      // PDF/tiskalno poročilo ima lasten CSP (nonce) – izvzeto iz globalnega
      { source: "/((?!api/report/pdf).*)", headers: securityHeaders },
    ];
  },
};

export default nextConfig;
