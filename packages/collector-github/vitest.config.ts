import { fileURLToPath } from "node:url";

export default {
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@agent-dashboard/domain": fileURLToPath(new URL("../domain/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
};
