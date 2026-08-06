using System.Text;

namespace TestCenter.CredentialHelper;

internal static class Program
{
    private const string TargetPrefix = "UnityMultiDeviceTestCenter/Signing/";

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 2 || !IsValidTarget(args[1]))
            {
                Console.Error.WriteLine("Usage: put|get|delete UnityMultiDeviceTestCenter/Signing/<name>");
                return 2;
            }

            var target = args[1];
            return args[0] switch
            {
                "put" => Put(target),
                "get" => Get(target),
                "delete" => Delete(target),
                _ => InvalidCommand(),
            };
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"Credential helper failed: {exception.GetType().Name}.");
            return 1;
        }
    }

    private static int Put(string target)
    {
        var secret = Console.In.ReadToEnd();
        if (secret.Length == 0)
        {
            Console.Error.WriteLine("Credential secret is required.");
            return 2;
        }

        CredentialStore.Write(target, Encoding.UTF8.GetBytes(secret));
        return 0;
    }

    private static int Get(string target)
    {
        var secret = CredentialStore.Read(target);
        if (secret is null)
        {
            Console.Error.WriteLine("Credential was not found.");
            return 1;
        }

        using var output = Console.OpenStandardOutput();
        output.Write(secret, 0, secret.Length);
        return 0;
    }

    private static int Delete(string target)
    {
        CredentialStore.Delete(target);
        return 0;
    }

    private static int InvalidCommand()
    {
        Console.Error.WriteLine("Command must be put, get, or delete.");
        return 2;
    }

    private static bool IsValidTarget(string target)
    {
        if (!target.StartsWith(TargetPrefix, StringComparison.Ordinal) || target.Length <= TargetPrefix.Length)
        {
            return false;
        }

        return target[TargetPrefix.Length..].All(character =>
            char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-');
    }
}
