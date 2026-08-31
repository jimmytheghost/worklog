# Agent Dashboard Design Direction

Status: Phase 0 direction

Primary surface: local desktop web app

Reference: supplied dark guitar-tool screenshot, used only as a visual mood and composition reference

## Product feeling

The dashboard should feel like a calm technical instrument: dense enough to reward inspection, legible at a glance, and deliberate rather than decorative. It is a personal command center for GitHub activity, Codex work, agent relationships, and usage—not an admin template and not a novelty “AI” interface.

The screenshot contributes the following transferable qualities:

- A near-black canvas with subtle layers instead of floating, shadow-heavy cards.
- One dominant workspace visualization framed by compact controls and supporting readouts.
- Large editorial page titles paired with small uppercase technical labels.
- Fine graphite rules that organize dense information without visual clutter.
- Acid-lime as a precise signal for active or healthy state, with orange as a secondary signal.
- Generous outer whitespace despite high information density inside panels.

No guitar terminology, iconography, fretboard geometry, brand marks, or other domain-specific material should be reproduced.

## Visual principles

### Instrument, not ornament

Every visual element should explain state, enable comparison, or support navigation. Avoid ambient glows, animated noise, arbitrary gradients, and decorative charts. Small moments of motion should communicate data arrival, filtering, or topology changes.

### One dominant story per page

Each route should have a clear primary visualization. On Overview, that is the activity heatmap. Supporting metrics, projects, agents, and events should reinforce it rather than compete with it.

### Dense within structure, spacious around it

Use strong page margins and a restrained vertical rhythm around sections. Inside tables, toolbars, and charts, use compact spacing so the interface reads as an expert tool.

### State must be inspectable

Every aggregate should expose its metric, time range, source, freshness, and coverage when inspected. Inferred agent-to-repository links and incomplete push history must look different from confirmed data.

### Color is a signal

Lime represents selected, active, current, complete, or high Git activity depending on context. Orange represents AI-attributed activity, attention, partial confidence, or warnings depending on context. Neither color may be the sole carrier of meaning.

## Color and token direction

These are starting values for implementation and contrast testing, not a locked brand palette.

| Token | Suggested value | Use |
| --- | --- | --- |
| `--canvas` | `#0B0E0D` | Application background |
| `--surface-1` | `#101412` | Header and primary sections |
| `--surface-2` | `#151A18` | Controls, rows, selected chart backing |
| `--surface-3` | `#1B211F` | Hover and elevated state |
| `--border-subtle` | `#29312E` | Panel rules and separators |
| `--border-strong` | `#3B4642` | Focused control and emphasized boundaries |
| `--text-primary` | `#F2F0E9` | Headlines and primary values |
| `--text-secondary` | `#A5ADA8` | Descriptions and metadata |
| `--text-muted` | `#717A75` | De-emphasized labels; not for essential tiny text |
| `--accent-lime` | `#C7FF35` | Selection, active state, Git activity scale |
| `--accent-lime-soft` | `#8CB926` | Mid-intensity data state |
| `--accent-orange` | `#FF934D` | AI attribution, warnings, secondary comparison |
| `--danger` | `#FF656D` | Failed collectors and destructive outcomes |
| `--info` | `#72B7FF` | Neutral informational status and links |

Heatmap intensity should be expressed through a five-step ramp derived from the lime accent, beginning with `--surface-2`. Orange should not be mixed into that ramp; it can appear as an inset marker, split cell, outline, or secondary series when AI-attributed activity is shown.

Use semantic aliases such as `--status-success`, `--status-warning`, and `--status-error` in components rather than coupling behavior directly to palette names. Focus rings should be a high-contrast two-layer treatment that remains visible on lime, orange, and dark surfaces.

## Typography

Use a neutral grotesk sans-serif with open numerals for interface and display text. Prefer a locally bundled variable font if licensing and performance permit; otherwise use a system stack. A compact monospace face is appropriate for commit hashes, token counts, timestamps, branches, paths, and small technical labels.

Suggested type roles:

- Display: 48–72px desktop, 38–48px compact desktop, medium weight, tight tracking.
- Page title: 32–44px, medium weight.
- Metric value: 28–40px, tabular numerals.
- Section title: 18–22px, semibold.
- Body: 14–16px, regular, comfortable line height.
- UI label: 11–12px, semibold, uppercase, wide tracking.
- Technical metadata: 12–13px monospace, tabular numerals.

Uppercase labels should remain short. Sentence case is preferred for instructions, empty states, tooltips, and navigation. Numbers in metrics, chart axes, and tables should use tabular figures.

## Layout system

The desktop application uses a full-width top bar and a centered content frame with a maximum width around 1,520px. The content frame uses a 12-column grid, 20–24px gutters, and 32–48px page margins depending on viewport width.

- Top bar: 64–72px high; identity at left, primary routes centered or immediately adjacent, collector health and last sync at right.
- Page intro: eyebrow, oversized title, one-line explanation, and contextual summary or range control aligned opposite.
- Control rail: a bordered, compact row above the main visualization. Filters should use segmented controls, selects, and date controls with visible labels.
- Main visualization: full 12-column span and visually dominant.
- Supporting region: responsive two- or three-column modules below, aligned to the same grid.
- Panel construction: mostly flat sections defined by borders and surface shifts; 0–6px corner radius; minimal shadows.

Spacing should follow a 4px base. Recommended landmarks are 4, 8, 12, 16, 24, 32, 48, and 72px. Preserve more space between conceptual sections than between related controls.

## Overview wireframe

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Agent Dashboard      Overview  Projects  Agents  Usage    ● Synced 2m ago│
├──────────────────────────────────────────────────────────────────────────┤
│ ACTIVITY · AMERICA/DENVER                                                 │
│ Work, shipped.                                     [Last 12 months ▾]    │
│ A daily record of commits, pushes, and Codex activity.                   │
│                                                                          │
│ [Commits 1,284] [Pushes 418] [Active days 226] [Observed tokens 18.4M]   │
│                                                                          │
│ ┌─ ACTIVITY ────────────────────────────────────────────────────────────┐ │
│ │ Metric [Commits | Pushes]  Source [All ▾]  Projects [All ▾]          │ │
│ ├───────────────────────────────────────────────────────────────────────┤ │
│ │ Mon  ▫ ▫ ▪ ▫ ▫ ▪ ▪ ▫ ▫ ▫ ▪ ▪ ▪ …                         Aug       │ │
│ │ Wed  ▫ ▪ ▪ ▪ ▫ ▫ ▪ ▪ ▫ ▪ ▪ ▫ ▪ …    ← 53-week activity heatmap     │ │
│ │ Fri  ▪ ▫ ▫ ▪ ▪ ▪ ▪ ▫ ▫ ▪ ▫ ▪ ▪ …                                   │ │
│ │      Less ▫ ▪ ▪ ▪ ▪ More        AI-attributed ◉    [Coverage info]  │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│ ┌─ ACTIVE PROJECTS · 7 ─────────────────┐ ┌─ AGENTS · TODAY ───────────┐ │
│ │ repo          branch   commits  status│ │ parent task       running  │ │
│ │ dashboard     main          12  active│ │  ├─ data import   complete │ │
│ │ guitar-lab    feature/x      4  quiet │ │  └─ UI review     running  │ │
│ │ [View all projects]                  │ │ [View agent graph]          │ │
│ └───────────────────────────────────────┘ └─────────────────────────────┘ │
│                                                                          │
│ ┌─ RECENT ACTIVITY ─────────────────────────────────────────────────────┐ │
│ │ 22:18  Push observed  agent-dashboard/main     3 commits   GitHub    │ │
│ │ 21:54  Sub-agent completed  UI review          12m          Codex    │ │
│ │ [Filter]                                                   [View all]│ │
│ └───────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

The summary metrics are secondary to the heatmap and should not become four unrelated floating cards. They may sit in one ruled strip with shared alignment. Collector coverage and freshness should remain visible without dominating healthy states.

## Component inventory

### Shell and navigation

- App mark and product name
- Primary route tabs with active underline
- Global date-range control
- Sync/freshness indicator with collector detail popover
- Settings entry
- Command or quick-filter launcher, if later justified by use

### Data display

- Metric strip and metric item
- Activity heatmap with legend, cell tooltip, keyboard navigation, and day drill-down
- Compact time-series chart for usage trends
- Project activity table/list
- Agent tree and graph node
- Activity feed row
- Source badge, confidence badge, coverage badge, and freshness timestamp
- Empty, loading, stale, partial-data, and error states

### Controls

- Segmented metric switcher
- Labeled select and multi-select
- Date-range picker
- Search/filter field
- Toggle and checkbox
- Sortable table header
- Inline disclosure and details drawer

### Feedback

- Skeletons shaped like the final content
- Small non-blocking sync progress
- Toasts for user-triggered operations only
- Persistent inline collector failures with a recovery action
- Tooltip for definitions, provenance, and exact chart values

## Data visualization behavior

### Activity heatmap

- Preserve the familiar calendar geometry: columns are weeks, rows are local weekdays, and days use America/Denver boundaries by default.
- Default to raw commit count. Provide a clear metric switch between commits and pushes; never sum them into an unlabeled “activity” number.
- Use a stable five-step intensity scale computed for the selected metric and range. Document the bucket thresholds in the legend tooltip.
- Selecting a day opens an anchored popover or side drawer with exact totals, repositories, pushes, commits, agents, source, and coverage.
- AI attribution is an overlay, not a separate intensity dimension. Use an icon, inset dot, outline, or split treatment plus a label.
- Distinguish confirmed, correlated, and unknown attribution through icon/line treatment and text, not merely hue.
- Empty means a confirmed zero. Unknown or unobserved data uses a hatch, gap, or explicit unavailable marker and must not resemble zero.
- Hover and keyboard focus reveal the same information. Clicking pins the selection.

### Usage charts

- Codex-observed tokens and official OpenAI API usage are separate series and totals unless a future source contract proves they can be combined.
- Axes begin at zero when comparing volume. Tooltips show exact values, model/source, and time boundary.
- Avoid radial gauges for token totals and costs; time series and aligned bars make comparisons more honest.

### Agent topology

- Default to a readable parent/child tree for a selected task. A free-form force graph is optional, not the primary view.
- Status is shown with label and icon. Completed branches collapse; running and failed branches remain prominent.
- Inferred edges use a dashed line and confidence label. Confirmed edges use a solid line.
- Large trees should progressively disclose depth rather than shrinking labels beyond readability.

### Motion

Use 120–220ms transitions for selection, disclosure, and filter updates. New events may briefly highlight once. Respect `prefers-reduced-motion`; do not continuously pulse healthy statuses or animate heatmap cells on load.

## Accessibility expectations

- Target WCAG 2.2 AA for text, controls, focus visibility, target sizing, and interaction states.
- Maintain at least 4.5:1 contrast for normal text and 3:1 for large text and meaningful non-text graphics.
- Do not encode metric, status, source, or confidence through color alone.
- All chart information must be reachable by keyboard and available in an equivalent table or structured detail view.
- Use semantic landmarks, headings, buttons, tables, and lists before adding ARIA.
- Heatmap navigation should support arrow keys between dates, Enter/Space to inspect, and a skip link to its tabular equivalent.
- Tooltips must be dismissible, hoverable, and available on focus; important definitions must not exist only in tooltips.
- Minimum pointer target is 44×44px where practical; dense desktop rows may use smaller visible affordances inside a 44px interaction area.
- Support 200% text zoom without loss of content or function.

## Responsive expectations

The first release is desktop-first but should remain usable rather than merely scaled down.

- `>= 1280px`: full 12-column layout, complete heatmap, paired supporting panels.
- `960–1279px`: compact title scale, wrapped control rail, two-column supporting panels.
- `720–959px`: simplified navigation, single-column supporting panels, horizontally scrollable heatmap inside an explicitly labeled region.
- `< 720px`: stacked metrics, filter drawer, list-first project and agent summaries, and a horizontally scrollable or range-reduced heatmap. No essential control may sit off-screen without an affordance.

At every width, preserve metric names, exact values, freshness, and coverage before preserving decorative spacing. Tables should turn into structured rows only when columns can no longer remain legible.

## Visual non-goals

- No direct copy of the reference brand, logo, guitar controls, fretboard, or wording.
- No generic SaaS grid of rounded cards with large shadows.
- No neon cyberpunk glow, glassmorphism, fake terminal chrome, or animated star-field aesthetic.
- No humanoid robot illustrations or “AI magic” symbolism.
- No chart junk, decorative sparklines, or oversized metrics without context.
- No red/amber/green status system without icons and labels.
- No automatic implication that all Git or Codex activity is AI-authored.
- No presentation of missing push history as a true zero.
- No attempt to fit every future collector or control on the Overview page.

## Assumptions to validate during implementation

- The app is primarily used on a laptop or desktop in a dark environment.
- Dark mode is the initial authored theme; a light theme is not an MVP requirement.
- America/Denver is the default reporting timezone but is visible and configurable.
- GitHub commit/push activity is the Overview’s main visual story.
- The user values exact provenance and completeness warnings over a cosmetically seamless chart.
- Lime is acceptable as the primary active accent and orange as the AI/attention accent.
- Local-first data allows collector health and sync recency to be shown as system state rather than account-level cloud status.

Validate these assumptions with a static Overview prototype at desktop and narrow widths, a contrast audit of the implemented palette, keyboard testing of the heatmap, and a review using realistic dense, sparse, incomplete, and zero-data fixtures.
