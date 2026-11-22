import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3108";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    launchOptions: { executablePath: process.env.CAMPUSBITE_TEST_BROWSER || undefined },
  },
  webServer: [{
    command: "node tests/public-catalog-fixture.mjs",
    url: "http://127.0.0.1:3111",
    reuseExistingServer: false,
  }, {
    command: "node ./node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3108",
    env: { CAMPUSBITE_MODE: "preview", SUPABASE_URL: "http://127.0.0.1:3111", SUPABASE_PUBLISHABLE_KEY: "test-key", SUPABASE_SECRET_KEY: "test-server-key", STUDENT_SUPABASE_URL: "", STUDENT_SUPABASE_PUBLISHABLE_KEY: "" },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  }, {
    command: "node --require ./tests/razorpay-fixture.cjs ./node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3109",
    url: "http://127.0.0.1:3109/auth/student/callback",
    env: {
      CAMPUSBITE_MODE: "live",
      RAZORPAY_TEST_KEY_ID: "rzp_test_Fixture",
      RAZORPAY_TEST_KEY_SECRET: "admin-payment-fixture",
      RAZORPAY_KEY_ID: "rzp_test_CommerceFixture",
      RAZORPAY_KEY_SECRET: "student-payment-fixture",
      RAZORPAY_WEBHOOK_SECRET: "payment-webhook-fixture",
      COMMERCE_JOB_SECRET: "worker-fixture",
      CAMPUSBITE_STAFF_ORIGIN: "http://127.0.0.1:3000",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "campusbite-lpu.vercel.app",
      CAMPUSBITE_STUDENT_ORIGIN: "",
      STUDENT_SUPABASE_URL: "",
      STUDENT_SUPABASE_PUBLISHABLE_KEY: "",
      SUPABASE_URL: "http://127.0.0.1:3110",
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      SUPABASE_SECRET_KEY: "test-server-key",
    },
    reuseExistingServer: false,
    timeout: 120_000,
  }],
});
