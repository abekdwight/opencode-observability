import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3838",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev:full",
    url: "http://127.0.0.1:3838",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: "3838",
      OPENCODE_DB_PATH: "tests/fixtures/opencode-observability.sqlite",
      CODEX_STATE_DB_PATH: "tests/fixtures/nonexistent-codex-state.sqlite",
      CLAUDE_PROJECTS_DIR: "tests/fixtures/nonexistent-claude-projects",
    },
  },
});
