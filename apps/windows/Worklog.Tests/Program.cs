using System.Text.Json;
using Worklog.Core;

static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
Check(Display.Number(null) == "—", "Unknown must stay unavailable");
Check(Display.Number(0) == "0", "Known zero must stay zero");
Check(Display.Number(1_500_000) == "1.5M", "Compact numbers");
var now = DateTimeOffset.Parse("2026-10-25T12:00:00Z");
Check(new UsageWindow(120, 300, null).Remaining == 0, "Clamp overspent windows");
Check(new UsageWindow(-10, 10080, null).Remaining == 100, "Clamp remaining windows");
Check(new UsageWindow(25, 300, null).ResetLabel(now) == "Reset unavailable", "Unknown reset");
Check(new UsageWindow(25, 300, "2026-10-25T11:00:00Z").ResetLabel(now) == "Reset due · refresh", "Expired reset");
Check(new UsageWindow(25, 10080, "2026-10-27T13:01:00Z").ResetLabel(now) == "Resets in 2d 1h 1m", "Multi-day reset countdown");
Check(Display.Timestamp("2026-10-25T12:00:00Z", "America/Denver") == "Oct 25, 6:00 AM", "Service reporting timezone");
var raw = """
{"schemaVersion":1,"generatedAt":"2026-10-25T12:00:00Z","timezone":"America/Denver",
 "summary":[{"metric":"commits","value":0,"freshness":"stale","completeness":"partial"}],
 "sources":[{"sourceSystem":"github","status":"connected","freshness":"stale","completeness":"partial"}],
 "activityDays":[],"codexAccount":null,"prompt":"private prompt","toolOutput":"private output","credentials":"private credential"}
""";
var snapshot = Snapshot.Parse(raw);
Check(snapshot.Summary.Single().Name == "commits", "Decode metric names");
Check(snapshot.Summary.Single().Value == 0, "Decode known zero");
Check(Display.SourceLabel(snapshot.Sources.Single()).Contains("stale · partial"), "Preserve freshness and coverage");
Check(snapshot.CodexAccount is null, "Missing account stays unavailable");
var cache = JsonSerializer.Serialize(snapshot, Snapshot.Json);
Check(!cache.Contains("private"), "Cache only display allowlist");
Check(Snapshot.Parse(cache).Summary.Single().Value == 0, "Cache round trip");
var full = new DayActivity("2026-11-17", 2, 3, 5, 7);
Check(full.HeatmapValue("All") == 17 && full.HeatmapValue("Both") == 5, "All activity includes Codex, Both stays Git only");
var codex = new DayActivity("2026-11-17", null, null, 0, 3);
Check(codex.HeatmapValue("All") == 3 && codex.HeatmapValue("Both") is null, "Codex-only activity and unavailable Git");
Check(new DayActivity("2026-11-17", 0, 0, 0, 0).HeatmapValue("All") == 0, "Known zero activity");
Check(new DayActivity("2026-11-17", null, null).HeatmapValue("All") is null, "Unknown activity stays unavailable");
var daily = snapshot with { HeatmapDays = [codex], ActivityDays = [full] };
Check(daily.DisplayedHeatmapDays.Single() == codex, "Prefer daily projection over Git calendar");
Check((daily with { HeatmapDays = [] }).DisplayedHeatmapDays.Length == 0, "Explicit empty projection has no fallback");
Check((daily with { HeatmapDays = null }).DisplayedHeatmapDays.Single() == full, "Legacy calendar fallback");
var legacy = Snapshot.Parse(raw.Replace("\"activityDays\":[]", "\"activityDays\":[{\"date\":\"2026-11-17\",\"commits\":2,\"pushes\":1}]"));
Check(legacy.DisplayedHeatmapDays.Single().HeatmapValue("All") == 3 && legacy.DisplayedHeatmapDays.Single().Agents is null, "Legacy cache keeps absent agents unavailable");
var dailyCache = JsonSerializer.Serialize(daily, Snapshot.Json);
Check(Snapshot.Parse(dailyCache).DisplayedHeatmapDays.Single() == codex, "Heatmap display fields survive caching");
Check(!dailyCache.Contains("displayedHeatmapDays") && !dailyCache.Contains("description") && !dailyCache.Contains("private"), "Cache only allowlisted stored display fields");
try { Snapshot.Parse(raw.Replace("\"schemaVersion\":1", "\"schemaVersion\":2")); throw new Exception("Accepted unknown schema"); } catch (JsonException) { }
try { Summary.Parse("""{"schemaVersion":1,"period":"week","timezone":"America/Denver","metrics":{"tokens":null,"commits":0,"pushes":0,"activeDays":0,"projects":0},"recentActivity":[]}""", "day"); throw new Exception("Mixed ranges"); } catch (JsonException) { }
Console.WriteLine("Windows model checks passed (missing/zero, cache privacy, ranges, freshness, account windows).");
