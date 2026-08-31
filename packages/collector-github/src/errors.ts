import type { CollectionFailure, CollectionStream, GitHubCollectorErrorCode } from "./types.js";

export class GitHubCollectorError extends Error {
  readonly code: GitHubCollectorErrorCode;

  constructor(code: GitHubCollectorErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitHubCollectorError";
    this.code = code;
  }
}

export function collectionFailure(
  error: unknown,
  stream: CollectionStream,
  repositoryId?: string,
): CollectionFailure {
  const known = error instanceof GitHubCollectorError;
  return {
    stream,
    code: known ? error.code : "api_failed",
    message: known ? error.message : "GitHub collection failed",
    ...(repositoryId === undefined ? {} : { repositoryId }),
  };
}
