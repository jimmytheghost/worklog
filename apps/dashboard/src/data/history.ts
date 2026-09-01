import { useEffect, useState } from "react";

export type HistoryActivity = { id: string; type: string; occurredAt: string; subject: string; detail: string; url: string | null; source: string; attribution: string; confidence: string };
export type HistoryProject = { projectId: string; name: string; owner: string; branch: string; commits: number; pushes: number; tokens: number | null; lastActivityAt: string; activity: HistoryActivity[] };
export type WorkHistory = {
  schemaVersion: number;
  month: string;
  timezone: string;
  range: { start: string; end: string };
  summary: { projects: number; commits: number; pushes: number; tokens: number | null };
  projects: HistoryProject[];
  sources: Array<{ sourceSystem?: string; name?: string; status?: string; detail?: string }>;
};
export type HistoryClient = (month: string, signal?: AbortSignal) => Promise<WorkHistory>;
export type SyncClient = () => Promise<void>;

function isHistory(value: unknown): value is WorkHistory {
  if (!value || typeof value !== "object") return false;
  const history = value as Partial<WorkHistory>;
  return history.schemaVersion === 1 && typeof history.month === "string" && typeof history.timezone === "string" && Boolean(history.range) && Boolean(history.summary) && Array.isArray(history.projects) && Array.isArray(history.sources);
}

export function createHistoryClient(fetcher: typeof fetch = fetch): HistoryClient {
  return async (month, signal) => {
    const response = await fetcher(`/api/history?month=${encodeURIComponent(month)}`, { headers: { accept: "application/json" }, ...(signal ? { signal } : {}) });
    if (!response.ok) throw new Error(`Work history request failed (${response.status})`);
    const payload: unknown = await response.json();
    if (!isHistory(payload)) throw new Error("Work history response did not match schema version 1");
    return payload;
  };
}

export function createSyncClient(fetcher: typeof fetch = fetch): SyncClient {
  return async () => {
    const response = await fetcher("/api/sync", { method: "POST", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Refresh request failed (${response.status})`);
  };
}
export const defaultHistoryClient = createHistoryClient();
export const defaultSyncClient = createSyncClient();

export function useHistory(client: HistoryClient, month: string, enabled: boolean) {
  const [state, setState] = useState<
    | { status: "idle" | "loading"; history: WorkHistory | null; error: null }
    | { status: "success"; history: WorkHistory; error: null }
    | { status: "error"; history: WorkHistory | null; error: Error }
  >({ status: "idle", history: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((current) => ({ status: "loading", history: current.history?.month === month ? current.history : null, error: null }));
    client(month, controller.signal).then(
      (history) => setState({ status: "success", history, error: null }),
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({ status: "error", history: current.history?.month === month ? current.history : null, error: reason instanceof Error ? reason : new Error("Work history is unavailable") }));
      },
    );
    return () => controller.abort();
  }, [client, enabled, month]);
  return state;
}
