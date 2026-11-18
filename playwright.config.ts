import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    launchOptions: { executablePath: process.env.CAMPUSBITE_TEST_BROWSER || undefined },
  },
  webServer: {
    command: "node ./node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3000",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
