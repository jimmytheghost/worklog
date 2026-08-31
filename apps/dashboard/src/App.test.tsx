import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("overview", () => {
  it("keeps commits and pushes as independently selectable metrics", () => {
    render(<App />);
    const commits = screen.getByRole("button", { name: "commits" });
    const pushes = screen.getByRole("button", { name: "pushes" });

    expect(commits).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pushes);
    expect(pushes).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Daily pushes heatmap" })).toBeInTheDocument();
  });

  it("exposes coverage and freshness in the main view", () => {
    render(<App />);
    expect(screen.getByText(/Pushes observed since May 14, 2026/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Collectors healthy, synced two minutes ago/i)).toBeInTheDocument();
  });
});
