using System.Diagnostics;
using System.Drawing;

namespace TestCenter.Launcher;

public sealed class LauncherForm : Form
{
    private readonly ServerProcess server = new();
    private readonly Label status = new();
    private readonly Button startButton = new();
    private readonly Button stopButton = new();
    private readonly Button openButton = new();
    private readonly string projectRoot;

    public LauncherForm()
    {
        projectRoot = LocateProjectRoot();
        Text = "Test Center · Unity Android";
        MinimumSize = new Size(560, 360);
        Size = new Size(700, 440);
        BackColor = Color.FromArgb(244, 240, 232);
        FormClosing += (_, _) => server.Dispose();

        var title = new Label { Text = "TEST CENTER", AutoSize = true, Font = new Font("Segoe UI", 22, FontStyle.Bold), ForeColor = Color.FromArgb(30, 48, 45), Location = new Point(32, 30) };
        var subtitle = new Label { Text = "Unity Android multi-device control plane", AutoSize = true, ForeColor = Color.FromArgb(105, 120, 120), Location = new Point(35, 72) };
        status.Text = "服务未启动";
        status.AutoSize = true;
        status.Location = new Point(36, 125);
        status.Font = new Font("Consolas", 12, FontStyle.Bold);
        status.ForeColor = Color.FromArgb(80, 101, 91);
        startButton.Text = "启动控制面";
        stopButton.Text = "停止服务";
        openButton.Text = "打开控制台";
        startButton.Width = stopButton.Width = openButton.Width = 130;
        startButton.Location = new Point(35, 175);
        stopButton.Location = new Point(180, 175);
        openButton.Location = new Point(325, 175);
        startButton.Click += async (_, _) => await StartAsync();
        stopButton.Click += (_, _) => Stop();
        openButton.Click += (_, _) => OpenConsole();
        stopButton.Enabled = false;
        openButton.Enabled = false;
        var path = new Label { Text = $"项目路径  {projectRoot}", AutoSize = false, Width = 620, Height = 45, Location = new Point(36, 245), ForeColor = Color.FromArgb(120, 130, 128) };
        Controls.AddRange([title, subtitle, status, startButton, stopButton, openButton, path]);
    }

    private async Task StartAsync()
    {
        startButton.Enabled = false;
        status.Text = "正在启动服务…";
        try
        {
            var port = await server.StartAsync(projectRoot);
            status.Text = $"服务就绪  127.0.0.1:{port}";
            stopButton.Enabled = true;
            openButton.Enabled = true;
            OpenConsole();
        }
        catch (Exception error)
        {
            status.Text = $"启动失败  {error.Message}";
            startButton.Enabled = true;
            MessageBox.Show(error.Message, "Test Center 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void Stop()
    {
        server.Stop();
        status.Text = "服务未启动";
        startButton.Enabled = true;
        stopButton.Enabled = false;
        openButton.Enabled = false;
    }

    private void OpenConsole()
    {
        if (server.Port == 0 || server.BootstrapCode is null) return;
        Process.Start(new ProcessStartInfo(BootstrapClient.CreateConsoleUrl(server.Port, server.BootstrapCode)) { UseShellExecute = true });
    }

    private static string LocateProjectRoot()
    {
        var current = new DirectoryInfo(Environment.CurrentDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "apps", "server", "dist", "main.js"))) return current.FullName;
            current = current.Parent;
        }
        return Environment.CurrentDirectory;
    }
}
