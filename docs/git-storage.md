# Git storage and the Windows checkout

The Windows Git metadata was moved out of Dropbox on November 17, 2026. Source files and the packaged executable keep their existing paths. Git commands still run from the source checkout without environment overrides.

## Current Windows layout

| Purpose | Location |
| --- | --- |
| Main source checkout | `F:\Dropbox\_Personal Projects\worklog` |
| Active common Git directory | `%LOCALAPPDATA%\Worklog\git` |
| Main checkout's Git pointer | `F:\Dropbox\_Personal Projects\worklog\.git` (a small text file, ignored by Dropbox) |
| Retained monochrome worktree | `%LOCALAPPDATA%\WorklogPreviews\monochrome-source` |
| Retained Windows runtime worktree | `%LOCALAPPDATA%\WorklogPreviews\windows-all-source-20261117` |
| Original metadata backup | `F:\WorklogGitBackups\20261117-223133\original.git` |
| Private migration records | `%LOCALAPPDATA%\Worklog\git-migrations\20261117-223133` |

Objects, refs, indexes, reflogs, stash, configuration, and linked-worktree administration now live in the common Git directory outside Dropbox. Both retained worktrees point there. The main checkout's `core.worktree` explicitly records its source path. Git's [separate-directory layout](https://git-scm.com/docs/git-init) uses a `.git` text file to locate the repository.

The `.git` pointer has the Windows `com.dropbox.ignored` stream set to `1`, using [Dropbox's documented ignore mechanism](https://help.dropbox.com/sync/ignored-files). Preserve this marker if the file is intentionally replaced. It keeps the Windows absolute path local to this machine. The marker is separate from `.gitignore`.

This migration covers Windows only. Each other machine needs its own Git metadata and local pointer, or its own clone outside Dropbox. Exchange commits through GitHub; do not sync or copy a machine's Git directory or pointer to another machine. Source and dependency files still live in Dropbox where noted, so this change does not eliminate conflicts in those files. Existing conflict copies and unrelated working changes were preserved.

## Verification and maintenance

From the main source checkout in PowerShell:

```powershell
git rev-parse --path-format=absolute --git-dir --git-common-dir --show-toplevel
Get-Content -LiteralPath .git
Get-Content -LiteralPath .git -Stream com.dropbox.ignored
git worktree list --porcelain
git fsck --full
git -C "$env:LOCALAPPDATA\WorklogPreviews\windows-all-source-20261117" rev-parse --path-format=absolute --git-common-dir
```

The first two paths from `rev-parse` must resolve to `%LOCALAPPDATA%\Worklog\git`; the source root must remain the Dropbox checkout. The ignore stream must read `1`. The retained worktree must resolve to the same common directory. With this separate-directory layout, `git worktree list` labels its first entry with the metadata path; use `rev-parse --show-toplevel` from the main checkout to locate its source files.

After intentionally moving Git storage or a linked worktree, run [`git worktree repair`](https://git-scm.com/docs/git-worktree) from the main checkout and repeat the checks above. Update `core.worktree` and the main pointer if their paths changed. Reapply the Dropbox marker to any replacement pointer while synchronization is paused:

```powershell
Set-Content -LiteralPath .git -Stream com.dropbox.ignored -Value 1
```

Moving only Git metadata does not require rebuilding or restarting Worklog. Moving a source checkout used by the package does require updating the package's recorded path; see the [Windows build and update notes](../apps/windows/README.md).

## Recovery

The complete original metadata backup was verified against all 1,216 original file hashes before subsequent Git activity. Its HEAD is `52bfe10`. The neighboring `original-remainder.git` directory retains files from an interrupted Windows directory move; `original.git` is the complete backup to use. Private before-state and validation records are in the migration-records directory above. Neither backups nor migration records belong in Git or Dropbox.

Keep the active Git directory and the source working files when recovering a missing pointer. Recreate the pointer to the active local directory, restore its Dropbox ignore marker before resuming synchronization, then run `git worktree repair`. Do not reinitialize an empty repository, delete the retained runtime checkout, or overwrite active metadata with the older backup during ordinary updates. The backup predates later commits and fetches; preserve newer Git state before using it for corruption recovery. Keep recovery metadata outside Dropbox.

## Migration checks

Before fetching newer commits, the move preserved every ref, stash entry, reflog, worktree status, and changed/untracked file hash. All original metadata files were archived; only the expected source-path configuration and repaired Git pointers changed in the active copy. `git fsck --full` passed with the same pre-existing dangling objects and no missing or corrupt objects. Fetching from GitHub and fast-forwarding the main checkout also succeeded.

The same single tray process and single service process stayed running. Health, snapshot, and Day-summary requests succeeded. The packaged executable, `checkout.json`, startup registration, and publisher task definition stayed unchanged; the publisher's last result was `0`. The retained runtime worktree and its built service remain available at their existing paths. No app or service code changed.
