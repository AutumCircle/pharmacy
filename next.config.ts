import type { NextConfig } from "next";
import dns from "node:dns";
import os from "node:os";

dns.setDefaultResultOrder("ipv4first");

const localDevOrigins = Object.values(os.networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .filter((address) => address.family === "IPv4" && !address.internal)
  .map((address) => address.address);

const nextConfig: NextConfig = {
  // Allow phones on the same LAN to load Next.js development assets/HMR.
  // The address is discovered on every dev-server start because Wi-Fi IPs change.
  allowedDevOrigins: [...new Set(localDevOrigins)],
};

export default nextConfig;
