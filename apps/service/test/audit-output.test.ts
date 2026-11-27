import { execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withNewAuditOutput } from "../scripts/audit-output.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "worklog-audit-output-"));
  roots.push(root);
  mkdirSync(join(root, ".agent-dashboard"));
  const database = join(root, "copy.sqlite");
  const live = join(root, ".agent-dashboard", "agent-dashboard.sqlite");
  // Deliberately invalid SQLite: opening either for migration must fail.
  writeFileSync(database, "DISPOSABLE_LEDGER_BYTES");
  writeFileSync(live, "SYNTHETIC_LIVE_LEDGER_BYTES");
  return { root, database, live, output: join(root, "activity.json") };
}
function unchanged(database: string, live: string) {
  expect(readFileSync(database, "utf8")).toBe("DISPOSABLE_LEDGER_BYTES");
  expect(readFileSync(live, "utf8")).toBe("SYNTHETIC_LIVE_LEDGER_BYTES");
}

describe("audit output reservation", () => {
  it.each(["input", "live", "input-symlink", "live-symlink", "input-hardlink", "live-hardlink"])(
    "rejects %s output before the CLI can migrate or collect", (kind) => {
      const { root, database, live, output } = fixture();
      const target = kind.startsWith("input") ? database : live;
      const destination = kind.includes("-") ? output : target;
      if (kind.endsWith("symlink")) symlinkSync(target, destination);
      if (kind.endsWith("hardlink")) linkSync(target, destination);
      let failure: { status?: number; stderr?: Buffer } | undefined;
      try {
        execFileSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../scripts/audit-daily-tokens.ts", import.meta.url)), database, destination], {
          env: { ...process.env, HOME: root }, stdio: "pipe",
        });
      } catch (error) { failure = error as typeof failure; }
      expect(failure?.status).toBe(1);
      expect(failure?.stderr?.toString()).toContain("Audit output must be a new file");
      expect(failure?.stderr?.toString()).not.toMatch(/not a database|SQLITE_NOTADB/);
      unchanged(database, live);
    },
  );

  it("rejects existing files and dangling symlinks before invoking work", async () => {
    const { database, live, output } = fixture();
    const work = vi.fn();
    writeFileSync(output, "PRESERVE_EXISTING_OUTPUT");
    await expect(withNewAuditOutput(database, output, live, work)).rejects.toThrow("new file");
    expect(readFileSync(output, "utf8")).toBe("PRESERVE_EXISTING_OUTPUT");
    unlinkSync(output);
    symlinkSync(output + ".missing", output);
    await expect(withNewAuditOutput(database, output, live, work)).rejects.toThrow("new file");
    expect(existsSync(output + ".missing")).toBe(false);
    expect(work).not.toHaveBeenCalled();
    unchanged(database, live);
  });

  it("rejects aliases used as the input before reserving an output", async () => {
    const { database, live, output } = fixture();
    unlinkSync(database);
    linkSync(live, database);
    const work = vi.fn();
    await expect(withNewAuditOutput(database, output, live, work)).rejects.toThrow("isolated backup");
    expect(existsSync(output)).toBe(false);
    expect(work).not.toHaveBeenCalled();
    expect(readFileSync(live, "utf8")).toBe("SYNTHETIC_LIVE_LEDGER_BYTES");
  });

  it("writes through the reservation without following a replacement symlink", async () => {
    const { database, live, output } = fixture();
    await withNewAuditOutput(database, output, live, async descriptor => {
      expect(statSync(output).mode & 0o777).toBe(0o600);
      unlinkSync(output);
      symlinkSync(live, output);
      writeFileSync(descriptor, "PUBLIC_PROJECTION");
    });
    unchanged(database, live);
  });

  it("creates a new projection and cleans up its reservation after failure", async () => {
    const { database, live, output } = fixture();
    await expect(withNewAuditOutput(database, output, live, async descriptor => {
      writeFileSync(descriptor, "INCOMPLETE");
      throw new Error("synthetic collection failure");
    })).rejects.toThrow("synthetic collection failure");
    expect(existsSync(output)).toBe(false);
    await withNewAuditOutput(database, output, live, async descriptor => {
      writeFileSync(descriptor, '{"schemaVersion":1}');
    });
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({ schemaVersion: 1 });
    expect(statSync(output).mode & 0o777).toBe(0o600);
    unchanged(database, live);
  });
});
