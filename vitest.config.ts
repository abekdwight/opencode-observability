import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globals: true,
    include: ["tests/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    reporters: ["default"],
    setupFiles: ["./tests/setup.ts"],
  },
});
