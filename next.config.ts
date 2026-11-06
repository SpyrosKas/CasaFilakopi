import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Keeps the app portable to any Docker host (T1.12).
  output: "standalone",
};

export default withNextIntl(nextConfig);
