import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { normalizeSnapshot } from "./data/snapshot";
import { dashboardFixture } from "./fixtures";

const successfulClient = async () => dashboardFixture;

describe("overview", () => {
  it("renders a successful snapshot and keeps commit and push metrics independent", async () => {
    render(<App snapshotClient={successfulClient} />);
    const commits = await screen.findByRole("button", { name: "commits" });
    const pushes = screen.getByRole("button", { name: "pushes" });

    expect(commits).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pushes);
    expect(pushes).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Daily pushes heatmap" })).toBeInTheDocument();
  });

  it("exposes coverage and freshness in the main view", async () => {
    render(<App snapshotClient={successfulClient} />);
    expect(await screen.findByText(/Pushes observed since May 14, 2026/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Coverage is partial, snapshot loaded/i)).toBeInTheDocument();
  });

  it("shows a loading treatment while the client is pending", () => {
    render(<App snapshotClient={() => new Promise(() => undefined)} />);
    expect(screen.getByLabelText("Loading dashboard snapshot")).toHaveAttribute("aria-busy", "true");
  });

  it("shows a collector error when the snapshot cannot be loaded", async () => {
    render(<App snapshotClient={async () => { throw new Error("Service offline"); }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Service offline");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("uses an injected fallback while preserving the failure disclosure", async () => {
    render(<App snapshotClient={async () => { throw new Error("Service offline"); }} fallbackSnapshot={dashboardFixture} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Live collectors are unavailable"));
    expect(screen.getByRole("heading", { name: "Work, shipped." })).toBeInTheDocument();
  });

  it("explains empty local Codex agent and token states", async () => {
    const emptyCodex = {
      ...dashboardFixture,
      agents: [],
      metrics: dashboardFixture.metrics.map((metric) => metric.label === "Observed tokens"
        ? { ...metric, value: "—", delta: "Local", context: "No local token metadata yet" }
        : metric),
    };
    render(<App snapshotClient={async () => emptyCodex} />);

    expect(await screen.findByText("No local Codex sessions observed")).toBeInTheDocument();
    expect(screen.getByText("No local token metadata yet")).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "Experimental Codex data source" })).not.toBeInTheDocument();
  });

  it("labels observed Codex data as experimental local metadata", async () => {
    render(<App snapshotClient={successfulClient} />);

    expect(await screen.findByRole("note", { name: "Experimental Codex data source" })).toHaveTextContent("observed tokens are not billing usage");
    expect(screen.getByText("Observed locally — not billing usage")).toBeInTheDocument();
  });

  it("keeps session identities and resolves depth when children precede parents", () => {
    const api: Parameters<typeof normalizeSnapshot>[0] = {
      schemaVersion: 1,
      generatedAt: "2026-08-31T04:00:00.000Z",
      timezone: "America/Denver",
      summary: [{ metric: "codex_observed_tokens", value: 12400, completeness: "partial" }],
      activityDays: [],
      projects: [],
      agents: [
        { sessionId: "grandchild", parentSessionId: "child", projectId: "project", label: "Repeated label", model: "gpt-5", status: "running", startedAt: "2026-08-31T03:30:00.000Z", completedAt: null },
        { sessionId: "child", parentSessionId: "root", projectId: "project", label: "Repeated label", model: "gpt-5", status: "completed", startedAt: "2026-08-31T03:00:00.000Z", completedAt: "2026-08-31T03:20:00.000Z" },
        { sessionId: "root", parentSessionId: null, projectId: "project", label: "Root", model: "gpt-5", status: "running", startedAt: "2026-08-31T02:00:00.000Z", completedAt: null },
      ],
      recentActivity: [],
      sources: [{ sourceSystem: "codex_local", status: "connected", freshness: "fresh", completeness: "partial", lastSucceededAt: "2026-08-31T03:59:00.000Z" }],
    };

    const snapshot = normalizeSnapshot(api);
    expect(snapshot.agents.map(({ id, depth }) => ({ id, depth }))).toEqual([
      { id: "grandchild", depth: 2 },
      { id: "child", depth: 1 },
      { id: "root", depth: 0 },
    ]);
    expect(snapshot.metrics.at(-1)?.context).toBe("Observed locally — not billing usage");
  });
});
