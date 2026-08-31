import type { CodexCollectorErrorCode } from "./types.js";

export class CodexCollectorError extends Error {
  readonly code: CodexCollectorErrorCode;

  constructor(code: CodexCollectorErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexCollectorError";
    this.code = code;
  }
}

export function sanitizedReadError(cause: unknown): CodexCollectorError {
  return cause instanceof CodexCollectorError
    ? cause
    : new CodexCollectorError("read_failed", "Codex metadata could not be read", { cause });
}
