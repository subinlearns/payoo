import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@coral-xyz/anchor", "@solana/web3.js", "@solana/spl-token"],
  // The repo root has its own package.json for the Anchor test suite.
  turbopack: { root: path.join(__dirname) },
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
