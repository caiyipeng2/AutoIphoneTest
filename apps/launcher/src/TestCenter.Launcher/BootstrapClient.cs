namespace TestCenter.Launcher;

public static class BootstrapClient
{
    public static string CreateConsoleUrl(int port, string bootstrapCode)
    {
        if (port is < 1 or > 65535) throw new ArgumentOutOfRangeException(nameof(port));
        if (string.IsNullOrWhiteSpace(bootstrapCode)) throw new ArgumentException("Bootstrap code is required.", nameof(bootstrapCode));
        return $"http://127.0.0.1:{port}/#overview?code={Uri.EscapeDataString(bootstrapCode)}";
    }
}
