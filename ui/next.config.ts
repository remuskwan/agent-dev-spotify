import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This UI lives in a subfolder of the agent repo; pin the root so Next
  // doesn't get confused by the parent package's lockfile.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
