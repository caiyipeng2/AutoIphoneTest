namespace Caiyipeng.TestCenter.QaBridge
{
    public interface IQaViewStateProvider
    {
        string ViewId { get; }
        string FocusedControlId { get; }
        bool TextInputAvailable { get; }
    }
}
