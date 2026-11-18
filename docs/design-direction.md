# Worklog Design Direction

Status: implemented baseline for continued refinement

## Product feeling

Worklog should feel like a calm native instrument: compact, immediate, precise, and comfortable in the macOS menu bar or Windows tray all day. The user should be able to open it, understand the current period, and close it in seconds. Windows takes its charcoal/mint palette and compact flyout controls from Tipoff alongside the macOS Worklog reference.

## Surface hierarchy

### 1. Native popover / tray flyout

This is the primary daily surface. On macOS the current composition is header, heatmap, account usage/range menu, summary metrics, recent work, and footer actions. The Windows composition is:

1. Worklog identity, status, and gear button.
2. Codex account plan, observation time, remaining-use gauges, and reset countdowns.
3. Six account facts in two columns of small inline label/value pairs: lifetime tokens, peak day, current/best streak, banked resets, and credits.
4. Day/Week/Month/Year/All buttons, followed by local tokens, commits, pushes, active days, and projects in one row. Agent and subagent range totals appear below.
5. A trailing 90-day grayscale heatmap, All/Commit/Push/Both controls with All selected initially, and all four selected-day counts.
6. Recent work and source status, freshness, and coverage.
7. Refresh, View on Website, and quit controls, outside the scrolling content. View on Website opens https://jimmyweber.com/worklog.

The popover should remain roughly task-bar sized. A vertical scroll area is acceptable when content exceeds the screen, but sections should not expand merely because more data exists.

### 2. Work History

The browser window is the complete archive. It can use more space for search, month navigation, project grouping, links, and detailed event rows. It should complement the popover rather than duplicate every control.

### 3. Public website

The fixed daily heatmap and period chart sit side by side on wide screens and stack on narrow screens. Date controls scroll within their charts, and weekday labels stay visible while the heatmap scrolls. Search and expandable project rows expose the merged history with direct GitHub commit links. The top navigation links to History and Sync status. The status table labels each device's source timestamps with Current, Stale, or Unavailable.

The public site uses a monospace masthead and dark surfaces. The top-left home link uses the same skull artwork as Tipoff's home link. Three labelled square buttons select green, neon blue, or grey and show the active palette with a check mark. The home mark follows the accent and appears white in the grey palette. Green is the default. [Public Worklog](https://www.jimmyweber.com/worklog/)

The summary range picker includes Today, calendar presets, months, and custom dates. Today displays the actual shared 24-hour report boundaries. Metric totals open the rounded, curved explorer with range/grouping controls, chart/table views, and CSV export; collapse returns to the overview. The activity chart has persistent canvas-colored scrollbar buttons and thumb with accent arrows/grip and a checkerboard track. The heatmap retains ordinary scrolling. [Published behavior and checks](../WEBSITE-HANDOFF.md)

## Visual language

- Near-black canvas with subtle graphite surfaces and separators.
- White primary text and quiet gray secondary labels.
- On Windows, selected range and heatmap-mode buttons use dark text on mint. Button labels inherit their control's foreground so a global text style cannot override selected-state contrast.
- Native heatmaps use grayscale intensity. The website uses five tones from the selected palette.
- Cyan/teal reserved for the Worklog identity and commit/action confirmation.
- Blue reserved for observed push events.
- Rounded native controls and panels, but no floating-card collage or heavy shadows.
- System typography and symbols: native macOS controls and Segoe UI in the Windows WPF flyout.
- Tabular numerals for counts.

Color is never the only carrier of meaning. Icons, labels, selection shapes, and exact values must reinforce it.

## Heatmap behavior

- The native heatmap covers the trailing 90 reporting dates when data is available. The public website uses the latest published date as its endpoint.
- macOS and the public website use Monday-first week columns. Windows uses 15 columns across six chronological rows, with date tooltips and separate selected-day counts.
- Commit mode scales from daily commit counts.
- All is the default and sums available commits, pushes, agents, and subagents; unavailable components remain visible in the selected-day detail.
- Push mode scales from daily push counts.
- Both mode uses the sum for cell intensity. Selected-day details keep the commit and push counts separate.
- On macOS and the public website, Agents and Subagents use daily counts of their respective session types. Selecting a date shows all four values.
- The heatmap is independent of the main range picker.
- The four-metric heatmaps distinguish zero, unavailable, and selected cells. macOS uses a dashed border for unavailable cells and an em dash in the detail. The website uses a dark solid tone for zero and four progressively brighter tones for positive values, relative to the highest day for the selected metric. It hatches unavailable cells and labels them in the selected-day detail.

## Range control

macOS uses a single compact native menu with one disclosure indicator. Windows uses five compact buttons with mint selection. Week includes today and the previous six local calendar days. Month includes today and the previous 29 local calendar days.

Changing the range updates metric cards and recent work without changing the 90-day heatmap.

## Interaction rules

- Cached content appears immediately on launch and reopen.
- Refresh is manual and automatic, but never blocks opening the popover.
- Healthy status stays quiet; failures explain what is stale and preserve the last successful data.
- Exact counts are available through selection even when abbreviated in cards.
- Links open the relevant GitHub item or Work History view.
- Motion is brief and functional. Respect reduced-motion preferences.
- Keyboard focus and VoiceOver labels should cover every control and heatmap cell.

## Layout guardrails

- Keep the header, heatmap, metrics, recent work, and footer visually distinct with spacing and subtle rules.
- Do not add permanent navigation rails, agent graphs, project leaderboards, or dense configuration panels to the popover.
- Do not hide historical projects to make the overview shorter; send exhaustive detail to Work History.
- Avoid decorative charts, neon glow, glass effects, fake terminal chrome, and oversized numbers without context.
- Prefer one useful row over a new panel, and one panel over a new screen.
- Keep Windows account facts smaller than the main range totals. Place account labels beside their values. Keep the main five range metrics on one row and the two Codex counts below, with labels and values on single lines.
- Keep the routine explanation of local counters and partial push and agent history in Windows Settings. Continue showing actual source-health, stale-data, and unavailable-data states in the overview.

## Definition of a good tweak

A change is successful when it makes the daily answer faster to read, makes the data more honest, or improves launch/reopen reliability without materially increasing background complexity. If a feature needs its own daemon, agent team, or ongoing supervision, it does not belong in this app by default.
