using System.Drawing;
using System.Windows;
using Forms = System.Windows.Forms;
using Point = System.Drawing.Point;

namespace Worklog.App;

public partial class App : System.Windows.Application
{
    private Mutex? instance;
    private Forms.NotifyIcon? tray;
    private Icon? icon;
    private MainWindow? flyout;
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        instance = new Mutex(true, "Local\\Worklog.Tray", out var first);
        if (!first) { Shutdown(); return; }
        ShutdownMode = ShutdownMode.OnExplicitShutdown;
        flyout = new MainWindow();
        var inspect = e.Args.Contains("--inspect");
        flyout.AutoHide = !inspect;
        if (inspect) { flyout.ShowInTaskbar = true; flyout.Topmost = false; }
        icon = CreateIcon();
        tray = new Forms.NotifyIcon { Icon = icon, Text = "Worklog", Visible = true, ContextMenuStrip = new Forms.ContextMenuStrip() };
        tray.ContextMenuStrip.Items.Add("Open Worklog", null, (_, _) => Open());
        tray.ContextMenuStrip.Items.Add("Refresh", null, async (_, _) => await flyout.RefreshAsync(true));
        tray.ContextMenuStrip.Items.Add("Work History", null, (_, _) => Worklog.App.MainWindow.OpenHistory());
        tray.ContextMenuStrip.Items.Add("Settings", null, (_, _) => { Open(); flyout.ShowSettings(); });
        tray.ContextMenuStrip.Items.Add(new Forms.ToolStripSeparator());
        tray.ContextMenuStrip.Items.Add("Quit Worklog", null, (_, _) => Shutdown());
        tray.MouseUp += (_, args) => { if (args.Button == Forms.MouseButtons.Left) { if (flyout.IsVisible) flyout.Hide(); else Open(); } };
        if (!e.Args.Contains("--startup")) Open();
        _ = flyout.RefreshAsync(false);
    }
    private void Open() { flyout!.ShowNearTaskbar(); _ = flyout.RefreshAsync(false); }
    private static Icon CreateIcon()
    {
        using var bitmap = new Bitmap(32, 32);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using var pen = new Pen(Color.FromArgb(64, 243, 223), 3);
        graphics.DrawLines(pen, new Point[] { new(1, 17), new(8, 17), new(12, 7), new(18, 26), new(23, 13), new(26, 17), new(31, 17) });
        var handle = bitmap.GetHicon();
        try { using var temporary = Icon.FromHandle(handle); return (Icon)temporary.Clone(); }
        finally { DestroyIcon(handle); }
    }
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr handle);
    protected override void OnExit(ExitEventArgs e)
    {
        tray?.Dispose(); icon?.Dispose(); flyout?.Dispose(); instance?.Dispose(); base.OnExit(e);
    }
}
