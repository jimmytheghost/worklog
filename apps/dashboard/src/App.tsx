import { useMemo, useRef, useState } from "react";
import { activity, agentTree, createActivityDays, metrics, projects, type DayActivity, type Metric } from "./fixtures";

const Icon = ({ name, size = 18 }: { name: "grid" | "folder" | "agent" | "usage" | "settings" | "arrow" | "branch" | "clock"; size?: number }) => {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    folder: <path d="M3 7.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-3H5a2 2 0 0 0-2 2v2.5Z"/>,
    agent: <><path d="M12 3v3M8 3h8M5 9h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/><circle cx="8" cy="14" r="1"/><circle cx="16" cy="14" r="1"/><path d="M8 17h8"/></>,
    usage: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V2"/><path d="M2 19h21"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.38.36.72.65 1 .29.28.67.43 1.05.4h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z"/></>,
    arrow: <path d="m9 18 6-6-6-6"/>,
    branch: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M18 8v2a4 4 0 0 1-4 4H6"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  } as const;
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
};

const navItems = [
  { label: "Overview", icon: "grid" },
  { label: "Projects", icon: "folder" },
  { label: "Agents", icon: "agent" },
  { label: "Usage", icon: "usage" },
] as const;

function Header() {
  return <header className="topbar">
    <a className="brand" href="#main" aria-label="Agent Dashboard overview">
      <span className="brand-mark"><span /><span /><span /></span>
      <span><strong>Agent</strong><small>Dashboard</small></span>
    </a>
    <nav aria-label="Primary navigation">
      {navItems.map((item, index) => <a key={item.label} className={index === 0 ? "active" : ""} href={index === 0 ? "#main" : `#${item.label.toLowerCase()}`} aria-current={index === 0 ? "page" : undefined}><Icon name={item.icon} />{item.label}</a>)}
    </nav>
    <div className="system-state">
      <button className="sync-button" type="button" aria-label="Collectors healthy, synced two minutes ago">
        <span className="status-dot" />
        <span><strong>All collectors healthy</strong><small>Synced 2m ago</small></span>
      </button>
      <button className="icon-button" type="button" aria-label="Settings"><Icon name="settings" /></button>
    </div>
  </header>;
}

function MetricStrip() {
  return <section className="metric-strip" aria-label="Year-to-date metrics">
    {metrics.map((metric) => <article className="metric" key={metric.label}>
      <p>{metric.label}</p>
      <div><strong>{metric.value}</strong><span>{metric.delta}</span></div>
      <small>{metric.context}</small>
    </article>)}
  </section>;
}

function intensity(value: number | null) {
  if (value === null) return "future";
  if (value === 0) return "zero";
  if (value === 1) return "low";
  if (value <= 3) return "mid";
  if (value <= 6) return "high";
  return "peak";
}

function friendlyDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function Heatmap() {
  const days = useMemo(() => createActivityDays(), []);
  const [metric, setMetric] = useState<Metric>("commits");
  const [selected, setSelected] = useState<DayActivity>(() => days[days.length - 2]!);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKey = (event: React.KeyboardEvent, index: number) => {
    const movement = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
    if (!movement) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(days.length - 1, index + movement));
    cellRefs.current[target]?.focus();
  };

  return <section className="activity-panel" aria-labelledby="activity-title">
    <div className="panel-toolbar">
      <div><span className="eyebrow" id="activity-title">Activity record</span><span className="toolbar-note">America / Denver</span></div>
      <div className="controls">
        <fieldset className="segment"><legend>Metric</legend>{(["commits", "pushes"] as Metric[]).map((value) => <button key={value} type="button" aria-pressed={metric === value} onClick={() => setMetric(value)}>{value}</button>)}</fieldset>
        <label className="select-control"><span>Source</span><select defaultValue="all"><option value="all">All sources</option><option>GitHub</option><option>Local Git</option></select></label>
        <label className="select-control"><span>Projects</span><select defaultValue="all"><option value="all">All projects</option><option>agent-dashboard</option><option>agentic-toolkit</option></select></label>
      </div>
    </div>
    <div className="heatmap-content">
      <div className="heatmap-scroll" role="region" aria-label={`Daily ${metric} heatmap`} tabIndex={0}>
        <div className="month-row" aria-hidden="true"><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span></div>
        <div className="heatmap-layout">
          <div className="weekday-labels" aria-hidden="true"><span>Mon</span><span>Wed</span><span>Fri</span></div>
          <div className="heatmap-grid">
            {days.map((day, index) => {
              const value = day[metric];
              return <button
                className={`day-cell ${intensity(value)} ${selected.date === day.date ? "selected" : ""}`}
                key={day.date}
                ref={(node) => { cellRefs.current[index] = node; }}
                type="button"
                aria-label={`${friendlyDate(day.date)}: ${value === null ? "not in range" : `${value} ${metric}`}${day.aiAttributed ? ", includes AI-attributed activity" : ""}`}
                aria-pressed={selected.date === day.date}
                onClick={() => setSelected(day)}
                onKeyDown={(event) => handleKey(event, index)}
              >{day.aiAttributed && <span aria-hidden="true" />}</button>;
            })}
          </div>
        </div>
      </div>
      <aside className="day-inspector" aria-live="polite">
        <div><span className="eyebrow">Selected day</span><strong>{friendlyDate(selected.date)}</strong></div>
        <div className="day-stats"><p><span>Commits</span><strong>{selected.commits ?? "—"}</strong></p><p><span>Pushes</span><strong>{selected.pushes ?? "—"}</strong></p><p><span>Projects</span><strong>{Math.min(4, selected.commits ?? 0)}</strong></p></div>
        <p className="inspection-note"><span className="confidence-mark" /> Codex attribution <strong>{selected.aiAttributed ? "Correlated" : "Unknown"}</strong></p>
      </aside>
    </div>
    <footer className="heatmap-footer">
      <div className="legend"><span>Less</span>{["zero", "low", "mid", "high", "peak"].map((level) => <i className={level} key={level} />)}<span>More</span><b><span /> AI-attributed</b></div>
      <p><span className="coverage-icon">◒</span><strong>Complete commit history</strong> · Pushes observed since May 14, 2026</p>
    </footer>
  </section>;
}

function SectionHeader({ eyebrow, title, action }: { eyebrow: string; title?: string; action: string }) {
  return <header className="section-header"><div><span className="eyebrow">{eyebrow}</span>{title && <h2>{title}</h2>}</div><a href="#details">{action}<Icon name="arrow" size={15} /></a></header>;
}

function ProjectsPanel() {
  return <section className="support-panel projects-panel" aria-labelledby="projects-title">
    <SectionHeader eyebrow="Active projects · 7" title="Where the work is moving" action="View all" />
    <div className="project-table" role="table" aria-label="Active projects">
      <div className="project-head" role="row"><span role="columnheader" id="projects-title">Repository</span><span role="columnheader">Commits</span><span role="columnheader">Agents</span><span role="columnheader">Updated</span></div>
      {projects.map((project) => <a className="project-row" href="#project" role="row" key={project.name}>
        <span role="cell"><strong>{project.name}</strong><small><Icon name="branch" size={12} />{project.branch}</small></span>
        <strong role="cell">{project.commits}</strong><span role="cell">{project.agents || "—"}</span><span role="cell">{project.updated}</span>
      </a>)}
    </div>
  </section>;
}

function AgentsPanel() {
  return <section className="support-panel agents-panel" aria-labelledby="agents-title">
    <SectionHeader eyebrow="Agents · Today" title="One task in motion" action="Open graph" />
    <ol className="agent-tree" id="agents-title">
      {agentTree.map((agent) => <li key={agent.name} style={{ "--depth": agent.depth } as React.CSSProperties} className={`agent-row depth-${agent.depth}`}>
        <span className={`agent-node ${agent.status.toLowerCase()}`}><Icon name="agent" size={14} /></span>
        <span className="agent-copy"><strong>{agent.name}</strong><small>{agent.meta}</small></span>
        <span className={`status-label ${agent.status.toLowerCase()}`}>{agent.status}</span>
        <span className="duration">{agent.duration}</span>
      </li>)}
    </ol>
    <div className="agent-summary"><p><span>3</span> agents spawned</p><p><span>1</span> running now</p><p><span>30m</span> total runtime</p></div>
  </section>;
}

function ActivityFeed() {
  return <section className="feed-panel" aria-labelledby="feed-title">
    <SectionHeader eyebrow="Recent activity" action="View timeline" />
    <h2 className="sr-only" id="feed-title">Recent activity</h2>
    <ol className="activity-feed">
      {activity.map((event) => <li key={`${event.time}-${event.title}`}>
        <time>{event.time}</time><span className={`feed-mark ${event.tone}`} /><span className="feed-title"><strong>{event.title}</strong><small>{event.subject}</small></span><code>{event.detail}</code><span className="source-badge">{event.source}</span><button type="button" aria-label={`Inspect ${event.title}`}><Icon name="arrow" size={16} /></button>
      </li>)}
    </ol>
  </section>;
}

export function App() {
  return <>
    <a className="skip-link" href="#main">Skip to dashboard</a>
    <Header />
    <main id="main">
      <section className="page-intro">
        <div><p className="eyebrow"><span /> Activity · America / Denver</p><h1>Work, shipped.</h1><p>A daily record of commits, pushes, and the agents behind them.</p></div>
        <div className="range-summary"><span className="eyebrow">Reporting range</span><button type="button">Last 12 months <span>⌄</span></button><small><Icon name="clock" size={13} /> Sep 01, 2025 — Aug 30, 2026</small></div>
      </section>
      <MetricStrip />
      <Heatmap />
      <div className="support-grid"><ProjectsPanel /><AgentsPanel /></div>
      <ActivityFeed />
      <footer className="app-footer"><p><span className="status-dot" />Local ledger online</p><p>Read-only · Metadata only · <a href="#sources">Inspect data sources</a></p></footer>
    </main>
  </>;
}
