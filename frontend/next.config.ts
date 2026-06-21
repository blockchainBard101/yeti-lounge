import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude Walrus SDK (WebAssembly) from the SSR bundle.
  // These packages use platform-native WASM and must only run in the browser.
  serverExternalPackages: ["@mysten/walrus", "@mysten/walrus-wasm"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "aggregator.walrus-testnet.walrus.space",
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "4000",
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "4000",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "yeti-lounge-production.up.railway.app",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
