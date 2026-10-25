using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Win32;
using Worklog.Core;
using Button = System.Windows.Controls.Button;
using Orientation = System.Windows.Controls.Orientation;
using Brush = System.Windows.Media.Brush;
using Brushes = System.Windows.Media.Brushes;
using Color = System.Windows.Media.Color;
using Panel = System.Windows.Controls.Panel;
using ProgressBar = System.Windows.Controls.ProgressBar;

namespace Worklog.App;

public partial class MainWindow : Window, IDisposable
{
    private Snapshot? snapshot;
    private Summary? summary;
    private string period = "day", mode = "Both";
    private string? selectedDay;
    private bool busy, settings, cached;
    private string? error;
    private DateTimeOffset ignoreDeactivationUntil;
    private readonly DispatcherTimer timer;
    private static readonly string CachePath = Path.Combine(LocalService.DataDirectory, "snapshot.json");
    private const string StartupKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public bool AutoHide { get; set; } = true;
    public MainWindow()
    {
        InitializeComponent();
        try { snapshot = Snapshot.Parse(File.ReadAllText(CachePath)); cached = true; } catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException) { }
        Deactivated += (_, _) => { if (AutoHide && DateTimeOffset.UtcNow >= ignoreDeactivationUntil) Hide(); };
        PreviewKeyDown += (_, e) => { if (e.Key == System.Windows.Input.Key.Escape) Hide(); };
        SizeChanged += (_, _) => { if (IsVisible) Position(); };
        Closing += (_, e) => { e.Cancel = true; Hide(); };
        timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
        timer.Tick += async (_, _) => await RefreshAsync(false);
        timer.Start(); Render();
    }
    public void ShowNearTaskbar()
    {
        ignoreDeactivationUntil = DateTimeOffset.UtcNow.AddMilliseconds(400);
        MaxHeight = Math.Min(760, SystemParameters.WorkArea.Height - 20);
        Scroller.MaxHeight = Math.Max(120, MaxHeight - 125);
        Show(); UpdateLayout(); Position(); Activate();
    }
    private void Position()
    {
        var area = SystemParameters.WorkArea;
        Left = Math.Max(area.Left + 8, area.Right - ActualWidth - 10);
        Top = Math.Max(area.Top + 8, area.Bottom - ActualHeight - 10);
    }
    public async Task RefreshAsync(bool sync)
    {
        if (busy) return;
        busy = true; RefreshButton.IsEnabled = false;
        Status.Text = sync ? "Refreshing sources…" : "Reading local ledger…";
        try
        {
            await LocalService.EnsureAsync();
            if (sync) { using var response = await LocalService.Client.PostAsync("api/sync", null); response.EnsureSuccessStatusCode(); }
            var next = Snapshot.Parse(await LocalService.Client.GetStringAsync("api/snapshot"));
            snapshot = next; cached = false; error = null;
            try
            {
                var requested = period;
                var nextSummary = Summary.Parse(await LocalService.Client.GetStringAsync($"api/summary?period={requested}"), requested);
                if (period == requested) summary = nextSummary;
            }
            catch (Exception e) when (e is HttpRequestException or JsonException or TaskCanceledException)
            { summary = null; error = "Selected range unavailable · try Refresh"; }
            try
            {
                Directory.CreateDirectory(LocalService.DataDirectory);
                await File.WriteAllTextAsync(CachePath + ".tmp", JsonSerializer.Serialize(next, Snapshot.Json));
                File.Move(CachePath + ".tmp", CachePath, true);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { error = "Snapshot is live · offline cache could not be saved"; }
            using var health = JsonDocument.Parse(await LocalService.Client.GetStringAsync("health"));
            var states = new[] { "githubSync", "codexSync", "codexAccountSync" }.Select(k => health.RootElement.GetProperty(k).GetString()).ToArray();
            timer.Interval = TimeSpan.FromSeconds(states.Contains("running") ? 2 : 30);
            if (states.Contains("running")) error = "Refreshing sources · showing available data";
            else if (states.Contains("failed")) error = "Some sources failed · showing available data";
        }
        catch (Exception e) when (e is IOException or HttpRequestException or JsonException or TaskCanceledException or System.ComponentModel.Win32Exception or UnauthorizedAccessException)
        { cached = snapshot is not null; error = cached ? "Service unavailable · showing saved snapshot" : e.Message; summary = null; }
        finally { busy = false; RefreshButton.IsEnabled = true; Render(); }
    }
    private Brush Brush(string key) => (Brush)FindResource(key);
    private TextBlock Text(string text, double size = 12, string color = "Text") => new() { Text = text, FontSize = size, Foreground = Brush(color), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 2) };
    private StackPanel Card()
    {
        var panel = new StackPanel();
        ContentPanel.Children.Add(new Border { Background = Brush("Card"), CornerRadius = new CornerRadius(9), Padding = new Thickness(11), Margin = new Thickness(0, 0, 0, 10), Child = panel });
        return panel;
    }
    private Button Action(string label, Action action, bool selected = false)
    {
        var button = new Button { Content = label, Margin = new Thickness(0, 0, 4, 0), FontSize = 10, Padding = new Thickness(7, 5, 7, 5) };
        if (selected) { button.Background = Brush("Mint"); button.Foreground = Brush("Surface"); }
        button.Click += (_, _) => action(); return button;
    }
    private void Render()
    {
        ContentPanel.Children.Clear();
        Status.Text = error ?? (cached ? "Saved snapshot · checking service" : snapshot is null ? "Local ledger unavailable" : "Local ledger · " + snapshot.Timezone);
        if (settings) { RenderSettings(); return; }
        if (snapshot is null) { ContentPanel.Children.Add(Text("Your work, remembered.", 19)); ContentPanel.Children.Add(Text("Worklog reads your local GitHub and Codex activity. Use Refresh to start the local service.", 12, "Muted")); return; }
        ContentPanel.Children.Add(Text($"Snapshot · {Display.Timestamp(snapshot.GeneratedAt, snapshot.Timezone)}", 9, "Muted"));
        var account = Card(); account.Children.Add(Text("CODEX ACCOUNT", 10, "Muted"));
        var usage = snapshot.CodexAccount;
        account.Children.Add(Text(usage?.PlanType is string plan ? System.Globalization.CultureInfo.InvariantCulture.TextInfo.ToTitleCase(plan.Replace('_', ' ')) : "Usage unavailable", 14));
        if (usage is not null)
        {
            account.Children.Add(Text($"Observed · {Display.Timestamp(usage.ObservedAt, snapshot.Timezone)}", 9, "Muted"));
            foreach (var limit in usage.RateLimits ?? [])
                foreach (var window in new[] { limit.Primary, limit.Secondary }.OfType<UsageWindow>())
                {
                    account.Children.Add(Text($"{window.Remaining:0}% remaining · {limit.LimitName ?? limit.LimitId} · {window.Title}", 11));
                    account.Children.Add(new ProgressBar { Minimum = 0, Maximum = 100, Value = window.Remaining, Height = 4, Foreground = Brush("Mint"), Background = new SolidColorBrush(Color.FromRgb(60, 60, 60)), BorderThickness = new Thickness(0), Margin = new Thickness(0, 3, 0, 3) });
                    account.Children.Add(Text(window.ResetLabel(DateTimeOffset.UtcNow), 10, "Muted"));
                }
            var facts = new System.Windows.Controls.Primitives.UniformGrid { Columns = 3, Margin = new Thickness(0, 6, 0, 0) };
            Fact(facts, "Lifetime tokens", Display.Number(usage.TokenUsage?.LifetimeTokens));
            Fact(facts, "Peak day", Display.Number(usage.TokenUsage?.PeakDailyTokens));
            Fact(facts, "Current streak", Display.Number(usage.TokenUsage?.CurrentStreakDays));
            Fact(facts, "Best streak", Display.Number(usage.TokenUsage?.LongestStreakDays));
            Fact(facts, "Banked resets", Display.Number(usage.BankedResetCount));
            Fact(facts, "Credits", usage.Credits?.Unlimited == true ? "Unlimited" : usage.Credits?.Balance ?? "—");
            account.Children.Add(facts);
        }
        else account.Children.Add(Text("Sign in with Codex, then refresh Worklog.", 11, "Muted"));
        var ranges = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 10), IsEnabled = !busy };
        foreach (var value in new[] { "day", "week", "month", "year", "all" })
            ranges.Children.Add(Action(char.ToUpperInvariant(value[0]) + value[1..], () => { if (busy) return; period = value; summary = null; Render(); _ = RefreshAsync(false); }, period == value));
        ContentPanel.Children.Add(ranges);
        var metrics = new System.Windows.Controls.Primitives.UniformGrid { Columns = 5, Rows = 1, Margin = new Thickness(0, 0, 0, 10) };
        var totals = summary?.Period == period && !cached ? summary.Metrics : null;
        Fact(metrics, "Local tokens", Display.Number(totals?.Tokens)); Fact(metrics, "Commits", Display.Number(totals?.Commits)); Fact(metrics, "Pushes", Display.Number(totals?.Pushes));
        Fact(metrics, "Active days", Display.Number(totals?.ActiveDays)); Fact(metrics, "Projects", Display.Number(totals?.Projects));
        ContentPanel.Children.Add(metrics);
        ContentPanel.Children.Add(Text("Local tokens are observed session counters, separate from account limits. Push history is partial.", 10, "Muted"));
        RenderHeatmap();
        ContentPanel.Children.Add(Text("RECENT WORK", 10, "Muted"));
        if (totals is null) ContentPanel.Children.Add(Text("Selected range unavailable.", 11, "Muted"));
        else if (summary!.RecentActivity.Length == 0) ContentPanel.Children.Add(Text("No commits or pushes in this range.", 11, "Muted"));
        else foreach (var item in summary!.RecentActivity.Where(a => a.EventType is "git.commit.discovered" or "github.push.observed"))
        {
            ContentPanel.Children.Add(Text((item.EventType.Contains("push") ? "↑  " : "✓  ") + item.Summary));
            ContentPanel.Children.Add(Text(Display.Timestamp(item.OccurredAt, snapshot.Timezone), 9, "Muted"));
        }
        foreach (var source in snapshot.Sources) ContentPanel.Children.Add(Text(Display.SourceLabel(source), 9, "Muted"));
    }
    private void Fact(Panel grid, string label, string value)
    {
        var stack = new StackPanel { Margin = new Thickness(0, 3, 5, 6) };
        var number = Text(value, 17); number.TextWrapping = TextWrapping.NoWrap;
        var caption = Text(label, 9, "Muted"); caption.TextWrapping = TextWrapping.NoWrap;
        stack.Children.Add(number); stack.Children.Add(caption); grid.Children.Add(stack);
    }
    private void RenderHeatmap()
    {
        var panel = Card(); panel.Children.Add(Text("ACTIVITY · LAST 90 DAYS", 10, "Muted"));
        var modes = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 5, 0, 8) };
        foreach (var name in new[] { "Commit", "Push", "Both" }) modes.Children.Add(Action(name, () => { mode = name; Render(); }, mode == name));
        panel.Children.Add(modes);
        var days = (snapshot!.ActivityDays ?? []).TakeLast(90).ToArray();
        if (days.Length == 0) { panel.Children.Add(Text("Activity history unavailable", 11, "Muted")); return; }
        var grid = new System.Windows.Controls.Primitives.UniformGrid { Columns = 15 };
        foreach (var day in days)
        {
            var count = mode == "Commit" ? day.Commits : mode == "Push" ? day.Pushes : day.Commits + day.Pushes;
            var shade = (byte)(count == 0 ? 52 : Math.Min(225, 85 + Math.Log2(count + 1) * 28));
            var label = $"{day.Date}: {day.Commits:0} commits · {day.Pushes:0} pushes";
            var button = new Button { Width = 15, Height = 15, Padding = new Thickness(0), Margin = new Thickness(2), Background = new SolidColorBrush(Color.FromRgb(shade, shade, shade)), ToolTip = label, BorderThickness = new Thickness(1), BorderBrush = selectedDay == day.Date ? Brush("Mint") : Brushes.Transparent };
            System.Windows.Automation.AutomationProperties.SetName(button, label);
            button.Click += (_, _) => { selectedDay = day.Date; Render(); }; grid.Children.Add(button);
        }
        panel.Children.Add(grid);
        panel.Children.Add(Text(days.First().Date + "  —  " + days.Last().Date, 9, "Muted"));
        if (days.FirstOrDefault(d => d.Date == selectedDay) is { } selected) panel.Children.Add(Text($"{selected.Date} · {selected.Commits:0} commits · {selected.Pushes:0} pushes", 11));
    }
    public void ShowSettings() { settings = true; Render(); }
    private void RenderSettings()
    {
        ContentPanel.Children.Add(Action("‹ Back to overview", () => { settings = false; Render(); }));
        ContentPanel.Children.Add(Text("Settings", 20));
        var startup = new System.Windows.Controls.CheckBox { Content = "Start Worklog with Windows", Foreground = Brush("Text"), Margin = new Thickness(0, 12, 0, 12) };
        var command = $"\"{Environment.ProcessPath}\" --startup";
        try { using var key = Registry.CurrentUser.OpenSubKey(StartupKey); startup.IsChecked = key?.GetValue("Worklog") as string == command; }
        catch (Exception e) when (e is UnauthorizedAccessException or System.Security.SecurityException or IOException) { ContentPanel.Children.Add(Text("Startup setting unavailable", 11, "Muted")); }
        startup.Click += (_, _) =>
        {
            try { using var key = Registry.CurrentUser.CreateSubKey(StartupKey); if (startup.IsChecked == true) key.SetValue("Worklog", command); else key.DeleteValue("Worklog", false); }
            catch (Exception e) when (e is UnauthorizedAccessException or System.Security.SecurityException or IOException) { startup.IsChecked = false; Status.Text = "Could not update Windows startup"; }
        };
        ContentPanel.Children.Add(startup);
        ContentPanel.Children.Add(Text("Worklog for Windows", 14));
        ContentPanel.Children.Add(Text("A local work ledger. Shared as-is.\n\nOne local service at 127.0.0.1:4317. Quitting the tray leaves the service running.\n\nGitHub: gh auth login\nCodex: codex login\n\nReporting timezone: " + (snapshot?.Timezone ?? "America/Denver") + "\nSet SERVICE_TIMEZONE before starting the service to change it.\n\nSnapshots: " + LocalService.DataDirectory + "\nLedger: ~/.agent-dashboard\n\nLocal metadata only. No telemetry.", 11, "Muted"));
    }
    public static void OpenHistory() => Process.Start(new ProcessStartInfo("http://127.0.0.1:4317/?view=history") { UseShellExecute = true });
    private void Settings_Click(object sender, RoutedEventArgs e) { settings = !settings; Render(); }
    private async void Refresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync(true);
    private void History_Click(object sender, RoutedEventArgs e) => OpenHistory();
    private void Quit_Click(object sender, RoutedEventArgs e) => System.Windows.Application.Current.Shutdown();
    public void Dispose() { timer.Stop(); }
}
