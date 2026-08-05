using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace TestCenter.Launcher;

public sealed class ServerProcess : IDisposable
{
    private Process? process;
    private string? launchSecret;

    public int Port { get; private set; }
    public bool IsRunning => process is { HasExited: false };

    public async Task<int> StartAsync(string projectRoot, CancellationToken cancellationToken = default)
    {
        if (IsRunning) return Port;
        var nodePath = Path.Combine(projectRoot, "tools", "node", "22.23.1", "node.exe");
        var serverPath = Path.Combine(projectRoot, "apps", "server", "dist", "main.js");
        if (!File.Exists(nodePath)) throw new FileNotFoundException("项目内 Node 22.23.1 不存在。", nodePath);
        if (!File.Exists(serverPath)) throw new FileNotFoundException("服务构建产物不存在，请先运行 npm run build。", serverPath);

        launchSecret = RandomToken();
        var bootstrapCode = RandomToken();
        var requestedPort = FindAvailablePort();
        process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = $"\"{serverPath}\"",
                WorkingDirectory = projectRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            },
            EnableRaisingEvents = true,
        };
        process.ErrorDataReceived += (_, args) => { if (!string.IsNullOrWhiteSpace(args.Data)) LastError = args.Data; };
        if (!process.Start()) throw new InvalidOperationException("无法启动本地服务进程。");
        process.BeginErrorReadLine();
        await WriteInitFrameAsync(process.StandardInput.BaseStream, launchSecret, bootstrapCode, requestedPort, cancellationToken);
        process.StandardInput.Close();

        var readiness = await ReadReadinessAsync(process.StandardOutput, cancellationToken);
        if (!VerifyReadiness(readiness, launchSecret))
        {
            Stop();
            throw new InvalidOperationException("服务就绪签名校验失败。");
        }
        Port = readiness.Port;
        BootstrapCode = bootstrapCode;
        return Port;
    }

    public string? BootstrapCode { get; private set; }
    public string? LastError { get; private set; }

    public void Stop()
    {
        if (process is null) return;
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                process.WaitForExit(3000);
            }
        }
        finally
        {
            process.Dispose();
            process = null;
            launchSecret = null;
            BootstrapCode = null;
            Port = 0;
        }
    }

    public void Dispose() => Stop();

    private static async Task WriteInitFrameAsync(Stream stream, string secret, string code, int port, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(new { version = 1, launchSecret = secret, bootstrapCode = code, requestedPort = port });
        var header = new byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(header, (uint)payload.Length);
        await stream.WriteAsync(header, cancellationToken);
        await stream.WriteAsync(payload, cancellationToken);
        await stream.FlushAsync(cancellationToken);
    }

    private static async Task<Readiness> ReadReadinessAsync(StreamReader stdout, CancellationToken cancellationToken)
    {
        var line = await stdout.ReadLineAsync(cancellationToken) ?? throw new InvalidOperationException("服务未返回就绪记录。");
        var readiness = JsonSerializer.Deserialize<Readiness>(line, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        return readiness ?? throw new InvalidOperationException("服务就绪记录格式无效。");
    }

    private static bool VerifyReadiness(Readiness value, string secret)
    {
        var unsigned = $"{{\"version\":{value.Version},\"port\":{value.Port},\"pid\":{value.Pid},\"nonce\":{JsonSerializer.Serialize(value.Nonce)}}}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var expected = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(unsigned))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(value.Hmac));
    }

    private static int FindAvailablePort()
    {
        using var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        return ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
    }

    private static string RandomToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed record Readiness(int Version, int Port, int Pid, string Nonce, string Hmac);
}
