# Agent Dashboard Product Brief

## Product intent

Agent Dashboard is a private, local-first command center for understanding personal software work across GitHub and Codex. It should answer three questions quickly:

1. What did I build and ship?
2. What are my Codex agents doing?
3. How much AI capacity am I using?

The product favors trustworthy, inspectable data over vanity totals. It should feel like a polished instrument: dense enough to be useful, calm enough to check every day, and explicit about where each number came from.

## Primary workflows

### Review recent output

Open the dashboard and see daily, weekly, and yearly development activity. Switch between commits and pushes, inspect a day, and follow its events back to repositories and Codex tasks.

### Inspect a project

Select a repository to see its recent commits, observed pushes, branches, latest activity, associated Codex tasks, and collection status.

### Follow agent work

Review recent Codex tasks and their sub-agent hierarchy. See status, model, duration, token totals, associated project, and any Git activity confidently connected to the task.

### Understand usage

Review locally observed Codex token usage independently from official OpenAI API organization usage. Filter by time range, model, or project without implying that the two sources are equivalent.

### Verify the data

Inspect source, freshness, coverage, and attribution confidence for dashboard totals. Export or back up the local event history.

## MVP sections

### Overview

- Contribution-style daily activity grid with independent commit and push views
- Today, this week, and this year summary metrics
- Recently active projects and agents
- Unified chronological activity feed
- Visible sync freshness and incomplete-coverage states

### Projects

- Repositories owned by the configured GitHub account
- Activity history, latest commits, and observed pushes
- Branch, language, and last-activity context when available
- Codex tasks associated with each repository

### Agents

- Codex task history and current status
- Parent and sub-agent topology
- Model, duration, project, and locally observed token totals
- Correlated Git activity with explicit confidence labels

### Usage

- Locally observed Codex token usage
- Optional official OpenAI API organization usage
- Date, model, and project filters where supported by the source
- Source and collection coverage shown alongside every aggregate

### Settings and data

- GitHub, Codex, and optional OpenAI API connection state
- Repository inclusion controls
- Collector health, last sync, and history coverage
- Local database backup and export

## Product truth rules

These rules are part of the product contract, not presentation details.

### Commits and pushes are different events

A commit records a change to repository history. A push transfers one or more refs and may contain zero, one, or many commits. The dashboard stores and reports commits and pushes separately and never derives a push count from commit count.

### Coverage must be visible

Historical commits may be reconstructed from repository history. Historical pushes may not be fully recoverable. Push metrics must state the observation window, such as `Observed since 2026-09-01`, and must never present partial data as a lifetime total.

### Usage sources remain separate

Locally observed Codex tokens and official OpenAI API organization usage are different datasets. They may appear in one interface but must retain separate totals, labels, source metadata, and coverage. The product must not invent cost estimates where pricing or billing context is unavailable.

### Attribution and confidence remain separate

Activity attribution is classified as **Codex**, **human**, or **unknown**. The evidence supporting a relationship is classified independently as **confirmed**, **correlated**, or **unknown**. For example, a commit may be `Codex / correlated` when its repository, branch, SHA, and timing align with a task but no durable source identifier explicitly links them.

Inferred relationships must remain visibly distinguishable from confirmed relationships, and unknown activity must never be silently treated as human or AI-generated.

### Source and freshness are inspectable

Every aggregate must be traceable to a source adapter and collection time. Stale, unavailable, and partially collected data are product states with clear UI treatment, not silent failures.

### Collection is private and minimal

The MVP stores metadata needed for activity and usage analysis. It does not ingest prompt text, response text, terminal command contents, private source code, or repository file contents. Credentials remain local and are never written to application logs.

### Synchronization is idempotent

Re-running a collector over the same source records must not create duplicate events or inflate aggregates. Source identifiers and normalization versions must be retained for reconciliation.

## Explicit non-goals for the MVP

- Launching, steering, approving, or terminating agents
- Editing repositories, branches, issues, pull requests, or files
- Replacing GitHub, Codex, or an IDE
- Team analytics, employee monitoring, leaderboards, or public profiles
- Perfect reconstruction of push history before collection began
- Billing-grade accounting or combining unlike usage sources into one total
- Semantic analysis of prompts, responses, commands, or source code
- Supporting multiple GitHub or OpenAI identities
- Mobile applications, cloud synchronization, or multi-device hosting
- Desktop packaging before the local web experience is proven

## MVP acceptance criteria

The MVP is complete when all of the following are true:

- The application runs locally and binds services only to the loopback interface by default.
- A user can connect the configured GitHub identity and discover owned repositories.
- Commit import is repeatable, deduplicated, and reconciles with sampled repository history.
- Push activity is stored independently, and its first-observed date is visible anywhere a push aggregate appears.
- The overview heatmap can switch between commit and push counts and drill into a selected day.
- Project pages show recent Git activity, data freshness, and associated Codex tasks.
- The Codex adapter imports task metadata, parent/sub-agent relationships, model, timing, status, and locally observed token totals without storing conversational content.
- Agent-to-project and agent-to-Git relationships display their attribution confidence.
- Codex-observed usage and official API usage, when configured, remain separately labeled and totaled.
- Collector retries and full re-syncs do not create duplicate events.
- Empty, loading, stale, partial, disconnected, and collector-error states are understandable in the interface.
- The local event database can be exported or backed up.
- Automated tests cover event normalization, deduplication, day-boundary aggregation, and the primary Overview-to-detail workflow.

## Phased roadmap

### Phase 0: Product and data contract

Define metrics, non-goals, source adapters, normalized events, confidence rules, completeness behavior, and the initial overview wireframe. Exit when every proposed dashboard number has an identified source and failure state.

### Phase 1: Foundation

Create the local application, database migrations, deterministic fixtures, design system, navigation shell, and shared data-state components. Exit when the complete interface shell runs against sample data.

### Phase 2: GitHub vertical slice

Discover owned repositories, import commits, collect available push events, implement deduplication, and build the activity grid plus project drill-down. Exit when sampled dashboard totals reconcile with GitHub and local repository evidence.

### Phase 3: Codex vertical slice

Import metadata-only task records, normalize parent/sub-agent relationships, render agent topology, and correlate tasks with projects and Git events. Exit when recent Codex work can be navigated from agent to project with confidence labels.

### Phase 4: Usage and integration

Add Codex-observed usage, optional official OpenAI API usage, the unified activity feed, filters, and data export. Exit when each aggregate is traceable and source separation is preserved throughout the interface.

### Phase 5: Dogfooding and hardening

Reconcile totals, exercise edge cases, improve collector resilience, accessibility, performance, and visual quality, and validate backup recovery. Only then decide whether desktop packaging, webhooks, or broader account support provide enough value for a later release.

## Initial assumptions

- The dashboard serves one person and one GitHub identity: `JimmyTheGhost`.
- Repository scope defaults to owned repositories; forks and archived repositories can be included deliberately later.
- Calendar aggregation uses `America/Denver` day boundaries and stores source timestamps in UTC.
- Counts are raw event counts unless a view explicitly defines another measure.
- GitHub collection starts with authenticated local tooling and polling; prospective webhooks are a later option.
- Codex data is read through a versioned, metadata-only adapter because local formats may change.
- The MVP is read-only and local-first, using a durable local event ledger as its analytical foundation.
