import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: "http://localhost:4173",
  },
  webServer: {
    command: "npm run build && python3 -m http.server 4173 -d dist",
    port: 4173,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
