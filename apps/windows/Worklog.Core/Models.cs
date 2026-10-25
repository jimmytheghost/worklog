using System.Globalization;
using System.Text.Json;

namespace Worklog.Core;

// Only decoded display fields are cached. Unknown service fields are discarded.
public sealed record Snapshot(int SchemaVersion, string GeneratedAt, string Timezone,
    Metric[] Summary, Source[] Sources, DayActivity[]? ActivityDays, Account? CodexAccount)
{
    public static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    public static Snapshot Parse(string json)
    {
        var value = JsonSerializer.Deserialize<Snapshot>(json, Json) ?? throw new JsonException("Empty snapshot");
        if (value.SchemaVersion != 1 || value.Summary is null || value.Sources is null ||
            !DateTimeOffset.TryParse(value.GeneratedAt, out _) || string.IsNullOrWhiteSpace(value.Timezone))
            throw new JsonException("Unsupported snapshot");
        return value;
    }
}
public sealed record Metric([property: System.Text.Json.Serialization.JsonPropertyName("metric")] string Name, double? Value, string? Freshness, string? Completeness);
public sealed record Source(string SourceSystem, string Status, string Freshness, string? Completeness, string? LastSucceededAt);
public sealed record DayActivity(string Date, double Commits, double Pushes);
public sealed record Summary(int SchemaVersion, string Period, string Timezone, Totals Metrics, Activity[] RecentActivity)
{
    public static Summary Parse(string json, string period)
    {
        var value = JsonSerializer.Deserialize<Summary>(json, Snapshot.Json) ?? throw new JsonException("Empty summary");
        if (value.SchemaVersion != 1 || value.Period != period || value.Metrics is null || value.RecentActivity is null)
            throw new JsonException("Unexpected summary");
        return value;
    }
}
public sealed record Totals(double? Tokens, double Commits, double Pushes, double ActiveDays, double Projects);
public sealed record Activity(string EventId, string EventType, string OccurredAt, string Summary);
public sealed record Account(string ObservedAt, string? PlanType, Limit[] RateLimits, double? BankedResetCount, Credits? Credits, TokenUsage? TokenUsage);
public sealed record Limit(string LimitId, string? LimitName, UsageWindow? Primary, UsageWindow? Secondary);
public sealed record Credits(bool HasCredits, bool Unlimited, string? Balance);
public sealed record TokenUsage(double? LifetimeTokens, double? PeakDailyTokens, double? CurrentStreakDays, double? LongestStreakDays, double? LongestRunningTurnSeconds);
public sealed record UsageWindow(double UsedPercent, double? WindowDurationMinutes, string? ResetsAt)
{
    public double Remaining => Math.Clamp(100 - UsedPercent, 0, 100);
    public string Title => WindowDurationMinutes switch { 300 => "5-hour", 10080 => "Weekly", null => "Usage", var n => $"{n / 60:0.#}-hour" };
    public string ResetLabel(DateTimeOffset now)
    {
        if (!DateTimeOffset.TryParse(ResetsAt, out var reset)) return "Reset unavailable";
        if (reset <= now) return "Reset due · refresh";
        var minutes = (long)Math.Ceiling((reset - now).TotalMinutes);
        var days = minutes / 1440; var hours = minutes % 1440 / 60;
        return "Resets in " + (days > 0 ? $"{days}d " : "") + (hours > 0 ? $"{hours}h " : "") + $"{minutes % 60}m";
    }
}
public static class Display
{
    public static string Number(double? value) => value is not double n || !double.IsFinite(n) ? "—" : Math.Abs(n) switch
    {
        >= 1_000_000_000 => (n / 1_000_000_000).ToString("0.#", CultureInfo.InvariantCulture) + "B",
        >= 1_000_000 => (n / 1_000_000).ToString("0.#", CultureInfo.InvariantCulture) + "M",
        >= 1_000 => (n / 1_000).ToString("0.#", CultureInfo.InvariantCulture) + "K",
        _ => n.ToString("0", CultureInfo.InvariantCulture)
    };
    public static string SourceLabel(Source source)
    {
        var name = source.SourceSystem switch { "github" => "GitHub", "codex_local" => "Codex sessions", "codex_account" => "Codex account", _ => source.SourceSystem.Replace('_', ' ') };
        return $"{name}: {source.Status.Replace('_', ' ')} · {source.Freshness} · {source.Completeness ?? "coverage unknown"}";
    }
    public static string Timestamp(string instant, string timezone)
    {
        if (!DateTimeOffset.TryParse(instant, out var date)) return "Time unavailable";
        try { return TimeZoneInfo.ConvertTime(date, TimeZoneInfo.FindSystemTimeZoneById(timezone)).ToString("MMM d, h:mm tt", CultureInfo.InvariantCulture); }
        catch (TimeZoneNotFoundException) { return date.ToString("u", CultureInfo.InvariantCulture); }
    }
}
