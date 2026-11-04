import type { NextConfig } from "next";

// La API de Laravel se sirve bajo el mismo dominio que la web (/api/...): sin CORS y con el
// dominio de la empresa en el navegador. En producción lo hace Nginx; en local, este rewrite.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8010";

const nextConfig: NextConfig = {
  // Cada empresa entra por su subdominio: donguando.localhost:3000, cs.localhost:3000.
  allowedDevOrigins: ["*.localhost"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
