import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: here,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: "line",
  outputDir: path.resolve(here, "../../output/playwright/test-results"),
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai"
  },
  projects: [
    {
      name: "chromium-extension",
      testMatch: /extension\.spec\.ts/
    },
    {
      name: "chromium-ui",
      testMatch: /ui-contract\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "firefox-ui",
      testMatch: /ui-contract\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] }
    }
  ]
});
