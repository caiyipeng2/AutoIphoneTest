namespace Caiyipeng.TestCenter.QaBridge
{
    public interface IQaIdentityProvider
    {
        string Uid { get; }
        int InstallGeneration { get; }
        int AppDataGeneration { get; }
        string BuildId { get; }
    }
}
