import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The floating dev badge overlaps the debug drawer; build errors still show in the overlay.
  devIndicators: false,
  serverExternalPackages: ["postgres"],
  // The reseed button reads the committed fixture at runtime; make sure it ships with the server.
  outputFileTracingIncludes: { "/admin/**": ["./fixtures/company.json"] },
};

export default nextConfig;
