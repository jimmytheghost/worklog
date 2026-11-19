# Worklog Product Brief

Status: active product baseline

## Product intent

Worklog is a local-first record of one person's software work, with a separate public activity view. It should answer three questions in a few seconds:

1. What did I commit and push today, this week, this month, or this year?
2. Which projects did I touch, including the ones I would otherwise forget?
3. How much Codex usage remains, when does it reset, and how many tokens, agents, and subagents were observed?

The primary experience should feel like a task-bar utility: click the macOS menu-bar or Windows tray icon, read the answer, and move on. The complete monthly archive is available one click away. The app must stay small enough for one person to run without babysitting it.

## Current experience

### Native Worklog

- Day, Week, Month, Year, and All range selector.
- Fixed trailing 90-day grayscale heatmap with All (the default), Commit, Push, and Both modes on both platforms. macOS also has Agents and Subagents modes. Both apps show the selected day's four separate activity counts, preserving unavailable values.
- Observed tokens, commits, pushes, active days, projects, agents, and subagents across the selected range.
- Signed-in Codex rate-limit windows, reset times, token facts, credits, and available banked resets.
- Recent work with commit subjects and repository/ref push descriptions.
- Quiet refresh, cached-data, source-health, and shutdown behavior.
- Windows has a 360-unit WPF tray flyout styled alongside Tipoff, with compact account facts, the five original range metrics in one row, and agent and subagent totals below. Settings explains token and source coverage and includes opt-in startup. Source health remains in the overview.

### Work History

- The local API returns the complete archive by month.
- Work rows include dates, repositories, commit subjects, push descriptions, and links where available.
- Monthly agent and subagent totals include a daily breakdown of observed activity.
- All projects represented when they have qualifying recorded work.

### Public Worklog

- Activity totals, a 90-day heatmap for commits, pushes, agents, and subagents, a period chart, and searchable project history with clickable GitHub commit subjects. The range picker offers Today, 7/30/90 days, This year, All, individual months, and inclusive custom dates. Each total opens a curved metric explorer with chart/table views and aggregate CSV export.
- Static feeds from enrolled machines supply repository history and aggregate Codex usage. Shared commits and identified pushes count once. The heatmap ends on the latest published reporting date.
- Sync status shows the last reported GitHub commit, GitHub push, and Codex collection per machine, with distinct current, stale, and unavailable states.
- The header offers green, neon blue, and grey palettes. The browser remembers the selection, and each palette distinguishes zero and four activity levels in the heatmap.

[JimmyWeber.com/worklog](https://www.jimmyweber.com/worklog/)

## Range semantics

- **Day:** today in the configured local timezone.
- **Week:** today plus the previous six local calendar days.
- **Month:** the rolling 30 local calendar days ending today (today plus the previous 29 days).
- **Year:** the current local calendar year through now.
- **All:** the entire recorded local ledger.

The 90-day heatmap is an independent orientation tool and stays fixed when the summary range changes.

The public website's **Today** is a separate shared 24-hour reporting interval ending at the latest common quarter hour. Its caption and CSV show the exact boundaries. Git events and Codex aggregates use that same window; missing or stale reports remain qualified. Native Day continues to mean the local calendar day. Calendar-based public ranges use whole published months for observed token totals; partial months are unavailable rather than prorated. [Website range semantics](../WEBSITE-HANDOFF.md#today)

## Product truth rules

### Commits and pushes are different

A commit records repository history. A push changes one or more remote refs and can contain zero, one, or many commits. Worklog stores and reports them separately. “Both” is only a heatmap display mode; it does not merge their underlying meanings.

### Coverage must be honest

Reachable commit history can be reconstructed more completely than push history. GitHub only exposes recent push activity, so push totals are observed and partial, never presented as lifetime-complete.

### Codex account limits and local counters stay distinct

Usage remaining, reset timing, banked resets, credits, and lifetime facts come from the signed-in Codex account through Codex's official local app-server. Observed tokens and agent activity come from local session metadata. Agent and subagent totals sum daily counts of distinct active sessions and depend on retained records.

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
- Team analytics, employee monitoring, or leaderboards.
- Perfect reconstruction of pushes that GitHub no longer exposes.
- Billing-grade accounting or invented credit/cost estimates.
- Semantic analysis of source code or conversations.
- Cloud replication of local ledgers or Codex session stores, multi-user hosting, or mobile clients.
- A large multi-route dashboard that requires constant maintenance.

## Acceptance standard

Worklog is successful when it starts reliably, refreshes without intervention, remains useful when a source is temporarily unavailable, reports honest ranges, keeps commits and pushes separate, preserves the complete project archive, and can be understood at a glance from the menu bar.

Any new feature must earn its place by improving that daily loop without adding a second service, another always-running agent, or a maintenance-heavy subsystem.

## Pending native parity

Bring the daily agent and subagent heatmap modes to the Windows tray app using the shared snapshot contract. [Windows heatmap handoff](windows-heatmap-handoff.md)
