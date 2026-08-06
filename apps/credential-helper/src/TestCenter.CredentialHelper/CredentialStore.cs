using System.ComponentModel;
using System.Security.Cryptography;
using System.Runtime.InteropServices;

namespace TestCenter.CredentialHelper;

internal static class CredentialStore
{
    private const uint GenericCredentialType = 1;
    private const uint LocalMachinePersistence = 2;

    public static void Write(string target, byte[] secret)
    {
        var blob = Marshal.AllocHGlobal(secret.Length);
        try
        {
            Marshal.Copy(secret, 0, blob, secret.Length);
            var credential = new NativeCredential
            {
                Type = GenericCredentialType,
                TargetName = target,
                CredentialBlob = blob,
                CredentialBlobSize = (uint)secret.Length,
                Persist = LocalMachinePersistence,
                UserName = Environment.UserName,
            };
            if (!CredWrite(ref credential, 0)) ThrowLastError();
        }
        finally
        {
            Marshal.FreeHGlobal(blob);
            CryptographicOperations.ZeroMemory(secret);
        }
    }

    public static byte[]? Read(string target)
    {
        if (!CredRead(target, GenericCredentialType, 0, out var credentialPointer))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == 1168) return null;
            throw new Win32Exception(error);
        }

        try
        {
            var credential = Marshal.PtrToStructure<NativeCredential>(credentialPointer);
            var secret = new byte[credential.CredentialBlobSize];
            if (secret.Length > 0) Marshal.Copy(credential.CredentialBlob, secret, 0, secret.Length);
            return secret;
        }
        finally
        {
            CredFree(credentialPointer);
        }
    }

    public static void Delete(string target)
    {
        if (!CredDelete(target, GenericCredentialType, 0))
        {
            var error = Marshal.GetLastWin32Error();
            if (error != 1168) throw new Win32Exception(error);
        }
    }

    private static void ThrowLastError() => throw new Win32Exception(Marshal.GetLastWin32Error());

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeCredential
    {
        public uint Flags;
        public uint Type;
        public string? TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref NativeCredential userCredential, uint flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll")]
    private static extern bool CredFree(IntPtr credential);
}
