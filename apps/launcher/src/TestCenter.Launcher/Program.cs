using System.Threading;

namespace TestCenter.Launcher;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, "UnityMultiDeviceTestCenter.Singleton", out var acquired);
        if (!acquired)
        {
            MessageBox.Show("Test Center 已经在运行。", "Test Center", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new LauncherForm());
    }
}
