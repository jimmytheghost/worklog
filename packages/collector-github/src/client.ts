import { GitHubCollectorError } from "./errors.js";
import type { CommandRunner } from "./types.js";

const API_VERSION = "2022-11-28";

export class GhApiClient {
  constructor(
    private readonly runner: CommandRunner,
    private readonly command = "gh",
  ) {}

  async get<T>(endpoint: string): Promise<T> {
    return await this.execute<T>(endpoint, false);
  }

  async getPaginated<T>(endpoint: string): Promise<T[]> {
    const pages = await this.execute<unknown>(endpoint, true);
    if (!Array.isArray(pages)) {
      throw new GitHubCollectorError("malformed_response", "GitHub returned malformed paginated data");
    }

    const flattened: T[] = [];
    for (const page of pages) {
      if (!Array.isArray(page)) {
        throw new GitHubCollectorError("malformed_response", "GitHub returned a malformed page");
      }
      flattened.push(...(page as T[]));
    }
    return flattened;
  }

  private async execute<T>(endpoint: string, paginated: boolean): Promise<T> {
    const args = [
      "api",
      "--method",
      "GET",
      "-H",
      "Accept: application/vnd.github+json",
      "-H",
      `X-GitHub-Api-Version: ${API_VERSION}`,
      endpoint,
      ...(paginated ? ["--paginate", "--slurp"] : []),
    ];

    let result;
    try {
      result = await this.runner.run(this.command, args);
    } catch (error) {
      throw new GitHubCollectorError("gh_unavailable", "GitHub CLI is unavailable", { cause: error });
    }

    if (result.exitCode !== 0) {
      const isAuthenticationFailure = /auth|login|credential|401/i.test(result.stderr);
      throw new GitHubCollectorError(
        isAuthenticationFailure ? "authentication_failed" : "api_failed",
        isAuthenticationFailure
          ? "GitHub CLI authentication is required"
          : "GitHub API request failed",
      );
    }

    try {
      return JSON.parse(result.stdout) as T;
    } catch (error) {
      throw new GitHubCollectorError("malformed_response", "GitHub returned invalid JSON", {
        cause: error,
      });
    }
  }
}
