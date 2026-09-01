import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { WorkHistory } from "./data/history";
import { normalizeSnapshot, subscribeToTerminalSyncs } from "./data/snapshot";
import { dashboardFixture } from "./fixtures";

const history: WorkHistory = {
  schemaVersion: 1, month: "2026-08", timezone: "America/Denver", range: { start: "2026-08-01", end: "2026-09-01" },
  summary: { projects: 3, commits: 18, pushes: 7, tokens: 1_250_000 }, sources: [],
  projects: [
    { projectId: "one", name: "agent-dashboard", owner: "jimmy", branch: "main", commits: 10, pushes: 4, tokens: 1_000_000, lastActivityAt: "2026-08-30T18:00:00Z", activity: [{ id: "a", type: "commit", occurredAt: "2026-08-30T18:00:00Z", subject: "Build monthly work history", detail: "a1b2c3d", url: "https://github.com/example/commit/a", source: "github", attribution: "correlated", confidence: "high" }] },
    { projectId: "two", name: "guitar-lab", owner: "jimmy", branch: "main", commits: 5, pushes: 2, tokens: null, lastActivityAt: "2026-08-20T18:00:00Z", activity: [] },
    { projectId: "three", name: "quiet-project", owner: "studio", branch: "release", commits: 3, pushes: 1, tokens: 250_000, lastActivityAt: "2026-08-10T18:00:00Z", activity: [] },
  ],
};
const snapshotClient = async () => dashboardFixture;
const historyClient = vi.fn(async (month: string) => ({ ...history, month }));

describe("compact work ledger", () => {
  it("renders a compact overview without the old agent tree or dead navigation", async () => {
    render(<App snapshotClient={snapshotClient} historyClient={historyClient}/>);
    expect(await screen.findByRole("heading", { name: "Your work, remembered." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shipping rhythm" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.queryByText(/tasks in motion/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("opens work history and renders every project returned by the API", async () => {
    render(<App snapshotClient={snapshotClient} historyClient={historyClient}/>);
    fireEvent.click(await screen.findByRole("button", { name: /Open Work History/i }));
    expect(await screen.findByRole("heading", { name: "Work History" })).toBeInTheDocument();
    expect(screen.getByText("agent-dashboard")).toBeInTheDocument();
    expect(screen.getByText("guitar-lab")).toBeInTheDocument();
    expect(screen.getByText("quiet-project")).toBeInTheDocument();
    expect(screen.getByText("3 of 3 projects")).toBeInTheDocument();
    expect(screen.getByText("tokens unavailable")).toBeInTheDocument();
  });

  it("searches project names and commit subjects without dropping the full source list", async () => {
    render(<App snapshotClient={snapshotClient} historyClient={historyClient}/>);
    fireEvent.click(await screen.findByRole("button", { name: /Open Work History/i }));
    const search = await screen.findByPlaceholderText("Search projects or commits");
    fireEvent.change(search, { target: { value: "monthly" } });
    expect(screen.getByText("agent-dashboard")).toBeInTheDocument();
    expect(screen.queryByText("guitar-lab")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 3 projects")).toBeInTheDocument();
  });

  it("navigates months and requests that complete month", async () => {
    const client = vi.fn(async (month: string) => ({ ...history, month }));
    render(<App snapshotClient={snapshotClient} historyClient={client}/>);
    fireEvent.click(await screen.findByRole("button", { name: /Open Work History/i }));
    await screen.findByText("August 2026");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(await screen.findByText("July 2026")).toBeInTheDocument();
    await waitFor(() => expect(client).toHaveBeenLastCalledWith("2026-07", expect.any(AbortSignal)));
  });

  it("triggers both collectors through refresh and reports the request state", async () => {
    let finish: (() => void) | undefined;
    const syncClient = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<App snapshotClient={snapshotClient} historyClient={historyClient} syncClient={syncClient}/>);
    fireEvent.click(await screen.findByRole("button", { name: "Refresh now" }));
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    expect(syncClient).toHaveBeenCalledOnce();
    await act(async () => finish?.());
    expect(screen.getByText("Refresh started")).toBeInTheDocument();
  });

  it("keeps commit and push heatmap metrics independent", async () => {
    render(<App snapshotClient={snapshotClient} historyClient={historyClient}/>);
    const pushes = await screen.findByRole("button", { name: "pushes" });
    fireEvent.click(pushes);
    expect(pushes).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Daily pushes heatmap" })).toBeInTheDocument();
  });

  it("preserves partial, loading, and error states", async () => {
    const { unmount } = render(<App snapshotClient={snapshotClient} historyClient={historyClient}/>);
    expect(await screen.findByRole("status")).toHaveTextContent("Some activity may be incomplete");
    unmount();
    render(<App snapshotClient={() => new Promise(() => undefined)} historyClient={historyClient}/>);
    expect(screen.getByLabelText("Loading dashboard snapshot")).toHaveAttribute("aria-busy", "true");
  });

  it("refreshes the overview after terminal sync events", async () => {
    const refreshed = { ...dashboardFixture, metrics: dashboardFixture.metrics.map((metric) => metric.label === "Commits" ? { ...metric, value: "9,999" } : metric) };
    const client = vi.fn().mockResolvedValueOnce(dashboardFixture).mockResolvedValue(refreshed);
    const listeners = new Map<string, EventListener>();
    const subscriber = (refresh: () => void) => subscribeToTerminalSyncs(refresh, () => ({ addEventListener: (name: string, listener: EventListenerOrEventListenerObject) => { if (typeof listener === "function") listeners.set(name, listener); }, close: vi.fn() } as unknown as EventSource));
    render(<App snapshotClient={client} refreshSubscriber={subscriber} historyClient={historyClient}/>);
    expect(await screen.findByText("1,284")).toBeInTheDocument();
    act(() => listeners.get("github-sync")?.(new MessageEvent("github-sync", { data: JSON.stringify({ status: "succeeded" }) })));
    expect(await screen.findByText("9,999")).toBeInTheDocument();
  });

  it("keeps snapshot normalization coverage and local-day behavior", () => {
    const api: Parameters<typeof normalizeSnapshot>[0] = { schemaVersion: 1, generatedAt: "2026-09-01T04:00:00Z", timezone: "America/Denver", range: { start: "2026-08-01T06:00:00Z", end: "2026-09-01T06:00:00Z", timezone: "America/Denver" }, summary: [], activityDays: [{ date: "2026-08-30", commits: 7, pushes: 3, codexAttributedCommits: 0 }], projects: [], agents: [], recentActivity: [], sources: [] };
    expect(normalizeSnapshot(api).activityDays.at(-1)).toEqual({ date: "2026-08-31", commits: 0, pushes: 0, aiAttributed: false });
  });
});
