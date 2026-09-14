import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server (server.js + only the files it needs) for the packaged release. See tools/package.ps1.
  output: "standalone",
  // The launcher opens 127.0.0.1; let the development server accept that address as well as localhost
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
