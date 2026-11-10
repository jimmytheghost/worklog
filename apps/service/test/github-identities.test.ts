import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGitHubAuthorIdentities } from "../src/github-identities.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function configPath(contents?: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "worklog-identities-"));
  directories.push(directory);
  const path = join(directory, "identities.json");
  if (contents !== undefined) writeFileSync(path, JSON.stringify(contents));
  return path;
}

describe("GitHub author identity configuration", () => {
  it("supports missing configuration and normalizes explicit account-scoped aliases", () => {
    expect(readGitHubAuthorIdentities(configPath())).toEqual([]);
    expect(readGitHubAuthorIdentities(configPath({
      schemaVersion: 1,
      identities: [{ accountId: "42", email: " Person@MacBook.local " }],
    }))).toEqual([{ accountId: "42", email: "person@macbook.local" }]);
  });

  it("rejects malformed configuration without echoing its contents", () => {
    for (const contents of [
      { schemaVersion: 2, identities: [] },
      { schemaVersion: 1, identities: [{ accountId: "username", email: "SECRET" }] },
      { schemaVersion: 1, identities: [{ accountId: "42", email: "SECRET" }] },
      { schemaVersion: 1, identities: [], credentials: "SECRET" },
    ]) {
      expect(() => readGitHubAuthorIdentities(configPath(contents)))
        .toThrowError(/^Invalid GitHub author identities configuration$/);
    }
  });

  it("accepts exact historical addresses containing accidental smart quotes", () => {
    const email = "“person@example.test”";
    expect(readGitHubAuthorIdentities(configPath({
      schemaVersion: 1,
      identities: [{ accountId: "42", email }],
    }))).toEqual([{ accountId: "42", email }]);
  });
});
