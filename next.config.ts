import type { NextConfig } from "next";

// Headers de seguridad básicos (Fase 0 del informe "Radiografía MY
// STUDIO"). A propósito SIN Content-Security-Policy estricta todavía:
// Firebase Auth/Firestore/Storage, GA4 y los previews de audio pegan a
// varios dominios de Google y una CSP mal calibrada rompe el login sin
// avisar. Se puede sumar después, en modo report-only primero.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
