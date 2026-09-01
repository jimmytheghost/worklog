# Worklog Design Direction

Status: implemented baseline for continued refinement

## Product feeling

Worklog should feel like a calm macOS instrument: compact, immediate, precise, and native enough to live in the menu bar all day. It is not a miniature admin dashboard. The user should be able to open it, understand the current period, and close it in seconds.

## Surface hierarchy

### 1. Menu-bar popover

This is the primary daily surface. Its order is intentional:

1. Worklog identity, sync status, and Day/Week/Month/Year/All selector.
2. A fixed trailing 90-day grayscale activity heatmap.
3. Commit, Push, and Both segmented heatmap modes.
4. A small selected-day detail strip when a heatmap cell is clicked.
5. Observed tokens, commits, pushes, active days, and projects.
6. A short recent-work list.
7. Refresh, Open Work History, and quit controls.

The popover should remain roughly task-bar sized. A vertical scroll area is acceptable when content exceeds the screen, but sections should not expand merely because more data exists.

### 2. Work History

The browser window is the complete archive. It can use more space for search, month navigation, project grouping, links, and detailed event rows. It should complement the popover rather than duplicate every control.

## Visual language

- Near-black canvas with subtle graphite surfaces and separators.
- White primary text and quiet gray secondary labels.
- Grayscale heatmap intensity so the overview remains calm.
- Cyan/teal reserved for the Worklog identity and commit/action confirmation.
- Blue reserved for observed push events.
- Rounded native controls and panels, but no floating-card collage or heavy shadows.
- System typography and symbols so the utility feels at home on macOS.
- Tabular numerals for counts.

Color is never the only carrier of meaning. Icons, labels, selection shapes, and exact values must reinforce it.

## Heatmap behavior

- Always covers the last 90 local calendar days, including today.
- Uses compact week columns with local weekday rows.
- Commit mode scales from daily commit counts.
- Push mode scales from daily push counts.
- Both mode uses the sum only to choose cell intensity; selected-day details retain separate commit and push counts.
- Clicking a day selects it and reveals a single horizontal detail strip between the heatmap and metric cards.
- The heatmap is independent of the main range picker.
- A confirmed zero is visually distinct from a selected day. Unknown coverage must not be presented as a confident zero if that distinction becomes available in the API.

## Range control

Use a single compact native menu with one disclosure indicator. The label is the active range. Week means a rolling seven-day view—today and the previous six days—not a Monday-to-Sunday calendar week.

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

## Definition of a good tweak

A change is successful when it makes the daily answer faster to read, makes the data more honest, or improves launch/reopen reliability without materially increasing background complexity. If a feature needs its own daemon, agent team, or ongoing supervision, it does not belong in this app by default.
