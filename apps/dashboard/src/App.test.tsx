import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
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
});
