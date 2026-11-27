import { closeSync, fstatSync, lstatSync, openSync, realpathSync, statSync, unlinkSync } from "node:fs";

/** Reserve a new output before any database migration or collector work begins. */
export async function withNewAuditOutput<T>(
  database: string,
  output: string,
  live: string,
  work: (descriptor: number) => Promise<T>,
): Promise<T> {
  const inputStat = statSync(database), liveStat = statSync(live);
  if (realpathSync(database) === realpathSync(live)
    || (inputStat.dev === liveStat.dev && inputStat.ino === liveStat.ino)) {
    throw new Error("Use an isolated backup, never the live ledger");
  }
  // Exclusive creation rejects every existing target, including symlinks and
  // hard links to either ledger. Keep the descriptor so a later path replacement
  // cannot redirect the write to a ledger or another symlink target.
  let descriptor: number;
  try {
    descriptor = openSync(output, "wx", 0o600);
  } catch {
    throw new Error("Audit output must be a new file in an existing private directory");
  }
  const reserved = fstatSync(descriptor);
  let succeeded = false;
  try {
    const result = await work(descriptor);
    succeeded = true;
    return result;
  } finally {
    closeSync(descriptor);
    if (!succeeded) {
      // Remove only our reservation, never a substituted path or symlink.
      try {
        const current = lstatSync(output);
        if (current.dev === reserved.dev && current.ino === reserved.ino) unlinkSync(output);
      } catch { /* Preserve the original audit failure. */ }
    }
  }
}
