import { execFile } from "node:child_process";

import type { CommandResult, CommandRunner } from "./types.js";

const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** Executes one binary with an argument vector. It never invokes a command shell. */
export class ExecFileCommandRunner implements CommandRunner {
  async run(command: string, args: readonly string[]): Promise<CommandResult> {
    return await new Promise((resolve, reject) => {
      execFile(
        command,
        [...args],
        {
          encoding: "utf8",
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== "number") {
            reject(error);
            return;
          }

          resolve({
            stdout,
            stderr,
            exitCode: error && typeof error.code === "number" ? error.code : 0,
          });
        },
      );
    });
  }
}
