import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server (server.js + only the files it needs) for the packaged release. See tools/package.ps1.
  output: "standalone",
};

export default nextConfig;
