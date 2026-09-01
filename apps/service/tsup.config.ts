import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  external: ["better-sqlite3", "drizzle-orm", "fastify", "zod"],
  // Workspace packages intentionally export TypeScript source for development.
  // Bundle them into the production service while leaving native/vendor modules external.
  noExternal: [/^@agent-dashboard\//],
});
