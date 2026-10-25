using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;

namespace Worklog.App;

internal static class LocalService
{
    public static readonly HttpClient Client = new() { BaseAddress = new Uri("http://127.0.0.1:4317"), Timeout = TimeSpan.FromSeconds(15) };
    public static readonly string DataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Worklog");
    private static readonly SemaphoreSlim Gate = new(1);
    public static async Task EnsureAsync()
    {
        await Gate.WaitAsync();
        try
        {
            if (await HealthyAsync()) return;
            var configPath = Path.Combine(AppContext.BaseDirectory, "checkout.json");
            if (!File.Exists(configPath)) throw new IOException("Package Worklog first; checkout.json is missing.");
            using var config = JsonDocument.Parse(await File.ReadAllTextAsync(configPath));
            var root = config.RootElement.GetProperty("root").GetString()!;
            var node = config.RootElement.GetProperty("node").GetString()!;
            var server = Path.Combine(root, "apps", "service", "dist", "server.js");
            if (!File.Exists(server) || !File.Exists(node)) throw new IOException("Checkout or Node moved. Rebuild and package Worklog.");
            var start = new ProcessStartInfo(node) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add(server);
            start.Environment["SERVICE_HOST"] = "127.0.0.1";
            start.Environment["SERVICE_PORT"] = "4317";
            start.Environment["GITHUB_SYNC_ON_START"] = "true";
            start.Environment["CODEX_SYNC_ON_START"] = "true";
            start.Environment["SERVICE_LOG_LEVEL"] = "error";
            // npm's codex.cmd cannot be spawned directly by Node. Prefer its native binary.
            var codex = config.RootElement.TryGetProperty("codex", out var binary) ? binary.GetString() : null;
            if (!string.IsNullOrEmpty(codex) && File.Exists(codex)) start.Environment["CODEX_BINARY"] = codex;
            Directory.CreateDirectory(DataDirectory);
            var process = Process.Start(start) ?? throw new IOException("Could not start the local service.");
            // Drain pipes without persisting potentially sensitive command errors.
            _ = DrainAsync(process);
            for (var attempt = 0; attempt < 60; attempt++)
            {
                await Task.Delay(500);
                if (await HealthyAsync()) return;
                if (process.HasExited) throw new IOException("Service exited. Run pnpm build and check Node/GitHub/Codex setup.");
            }
            throw new IOException("Service is still unavailable. Check port 4317 and your checkout.");
        }
        finally { Gate.Release(); }
    }
    private static async Task DrainAsync(Process process)
    {
        try { await Task.WhenAll(process.StandardOutput.BaseStream.CopyToAsync(Stream.Null), process.StandardError.BaseStream.CopyToAsync(Stream.Null)); }
        catch (IOException) { }
    }
    private static async Task<bool> HealthyAsync()
    {
        try
        {
            using var response = await Client.GetAsync("health");
            response.EnsureSuccessStatusCode();
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            if (!json.RootElement.TryGetProperty("service", out var service) || service.GetString() != "@agent-dashboard/service")
                throw new IOException("Port 4317 belongs to another app.");
            return true;
        }
        catch (HttpRequestException) { return false; }
        catch (TaskCanceledException) { return false; }
        catch (JsonException) { throw new IOException("Port 4317 did not return Worklog health."); }
    }
}
