import { describe, expect, it } from "vitest";
import { ExecFileCommandRunner } from "../src/runner.js";

describe("GitHub command deadlines", () => {
  it("terminates a hung command and reports failure", async () => {
    const result = await new ExecFileCommandRunner(100).run(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    expect(result.exitCode).not.toBe(0);
  });
});
