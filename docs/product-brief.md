# Worklog Product Brief

Status: active product baseline

## Product intent

Worklog is a private, local-first record of the software work one person actually did. It should answer three questions in a few seconds:

1. What did I commit and push today, this week, this month, or this year?
2. Which projects did I touch, including the ones I would otherwise forget?
3. How much Codex usage remains, when does it reset, and how many tokens have been observed?

The primary experience should feel like a task-bar utility: click the macOS menu-bar or Windows tray icon, read the answer, and move on. The complete monthly archive is available one click away. The app must stay small enough for one person to run without babysitting it.

## Current experience

### Native Worklog

- Day, Week, Month, Year, and All range selector.
- Fixed trailing 90-day grayscale heatmap with Commit, Push, and Both modes.
- Clickable days with exact commit and push totals in a compact detail strip.
- Observed tokens, commits, pushes, active days, and project totals.
- Signed-in Codex rate-limit windows, reset times, token facts, credits, and available banked resets.
- Recent work with commit subjects and repository/ref push descriptions.
- Quiet refresh, cached-data, source-health, and shutdown behavior.
- Windows has a 360-unit WPF tray flyout styled alongside Tipoff: compact account facts, five range metrics in one row, and dark text on mint-selected buttons. Settings holds the routine token/coverage explanation and opt-in startup registration; actual source health remains in the overview.

### Work History

- Complete month-by-month archive rather than a “top projects” ranking.
- Searchable work rows with dates, repositories, commit subjects, push descriptions, and links where available.
- All projects represented when they have qualifying recorded work.

## Range semantics

- **Day:** today in the configured local timezone.
- **Week:** today plus the previous six local calendar days.
- **Month:** the rolling 30 local calendar days ending today (today plus the previous 29 days).
- **Year:** the current local calendar year through now.
- **All:** the entire recorded local ledger.

The 90-day heatmap is an independent orientation tool and stays fixed when the summary range changes.

## Product truth rules

### Commits and pushes are different

A commit records repository history. A push changes one or more remote refs and can contain zero, one, or many commits. Worklog stores and reports them separately. “Both” is only a heatmap display mode; it does not merge their underlying meanings.

### Coverage must be honest

Reachable commit history can be reconstructed more completely than push history. GitHub only exposes recent push activity, so push totals are observed and partial, never presented as lifetime-complete.

### Codex account limits and local counters stay distinct

Usage remaining, reset timing, banked resets, credits, and lifetime facts come from the signed-in Codex account through Codex's official local app-server. Per-session observed token totals still come from local counters. Neither is presented as an invoice or an invented monetary estimate, and the two sources are never silently combined.

### The archive must not forget projects

Compact overview space may show only recent events, but Work History must retain every project with recorded activity for the selected month. No project disappears because it falls below an arbitrary top-four or top-five cutoff.

### Missing is not zero

Unknown, unavailable, partial, stale, and confirmed zero are different states. The interface must not silently turn one into another.

### Collection is private and minimal

Worklog stores the metadata required to explain activity. It does not ingest prompts, responses, commands, tool output, source files, diffs, patches, file lists, or commit bodies. Privacy-safe first-line commit subjects and canonical GitHub links are allowed.

## Explicit non-goals

- Launching, steering, approving, or terminating agents.
- A live agent hierarchy or operations console.
- Editing repositories, branches, issues, pull requests, or files.
- Team analytics, employee monitoring, leaderboards, or public profiles.
- Perfect reconstruction of pushes that GitHub no longer exposes.
- Billing-grade accounting or invented credit/cost estimates.
- Semantic analysis of source code or conversations.
- Cloud synchronization, multi-user hosting, or mobile clients.
- A large multi-route dashboard that requires constant maintenance.

## Acceptance standard

Worklog is successful when it starts reliably, refreshes without intervention, remains useful when a source is temporarily unavailable, reports honest ranges, keeps commits and pushes separate, preserves the complete project archive, and can be understood at a glance from the menu bar.

Any new feature must earn its place by improving that daily loop without adding a second service, another always-running agent, or a maintenance-heavy subsystem.

## Next product phase

Continue with visual and interaction refinements based on real daily use. Prefer small, testable improvements to the existing popover and Work History. Add new collectors or deeper analysis only after the core work ledger has proven a clear gap.
