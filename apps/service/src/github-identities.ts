import { readFileSync } from "node:fs";
import { z } from "zod";
import type { GitHubAuthorIdentity } from "@agent-dashboard/collector-github";

const identitiesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  identities: z.array(z.strictObject({
    accountId: z.string().regex(/^\d+$/),
    // Git permits malformed historical addresses, including smart quotes.
    // Keep exact aliases usable while rejecting names, whitespace and delimiters.
    email: z.string().trim().toLowerCase().max(320).regex(/^[^\s<>@]+@[^\s<>@]+$/u),
  })),
});

export function readGitHubAuthorIdentities(path: string): GitHubAuthorIdentity[] {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("Could not read GitHub author identities configuration");
  }
  try {
    return identitiesSchema.parse(JSON.parse(contents)).identities;
  } catch {
    // Do not expose the file's contents in logs or validation diagnostics.
    throw new Error("Invalid GitHub author identities configuration");
  }
}
