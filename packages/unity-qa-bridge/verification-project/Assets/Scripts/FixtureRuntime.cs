using UnityEngine;
using UnityEngine.UI;
#if UNITY_MULTI_DEVICE_QA
using Caiyipeng.TestCenter.QaBridge;
#endif

namespace Caiyipeng.TestCenter.QaFixture
{
    public sealed class FixtureRuntime : MonoBehaviour
    {
        [SerializeField] private Text uidLabel;
        [SerializeField] private Text generationLabel;
        [SerializeField] private Text metricsLabel;
        [SerializeField] private Text actionLabel;
        [SerializeField] private Text backLabel;
        [SerializeField] private InputField inputField;

        private int tapCount;
        private int swipeCount;
        private int backCount;
        private string focusedControlId;

        public string CurrentView => "MainHUD";
        public string FocusedControlId => focusedControlId;
        public bool TextInputAvailable => inputField != null && inputField.isFocused;
        public int MetricsEpoch
        {
            get
            {
#if UNITY_MULTI_DEVICE_QA
                return QaBridgeBootstrap.Instance != null && QaBridgeBootstrap.Instance.Server != null
                    ? QaBridgeBootstrap.Instance.Server.MetricsEpoch
                    : 0;
#else
                return 0;
#endif
            }
        }

        public void Configure(Text uid, Text generation, Text metrics, Text action, Text back, InputField input)
        {
            uidLabel = uid;
            generationLabel = generation;
            metricsLabel = metrics;
            actionLabel = action;
            backLabel = back;
            inputField = input;
        }

        public void SetIdentity(string uid, int installGeneration, int appDataGeneration, string buildId)
        {
            if (uidLabel != null) uidLabel.text = "UID: " + uid;
            if (generationLabel != null) generationLabel.text = $"Install generation: {installGeneration}  |  App data: {appDataGeneration}  |  Build: {buildId}";
        }

        public void SetFocusedControl(string controlId)
        {
            focusedControlId = controlId;
            RefreshLabels();
        }

        public void ClearFocusedControl(string controlId)
        {
            if (focusedControlId == controlId) focusedControlId = null;
            RefreshLabels();
        }

        public void RegisterTap(string controlId)
        {
            tapCount++;
            if (actionLabel != null) actionLabel.text = $"Last action: tap {controlId}  |  taps={tapCount}  swipes={swipeCount}";
        }

        public void RegisterSwipe(string controlId)
        {
            swipeCount++;
            if (actionLabel != null) actionLabel.text = $"Last action: swipe {controlId}  |  taps={tapCount}  swipes={swipeCount}";
        }

        private void Update()
        {
            if (Input.GetKeyDown(KeyCode.Escape)) backCount++;
            RefreshLabels();
        }

        private void RefreshLabels()
        {
            if (metricsLabel != null)
            {
                metricsLabel.text = $"View: {CurrentView}  |  Focus: {focusedControlId ?? "none"}  |  Metrics epoch: {MetricsEpoch}";
            }
            if (backLabel != null) backLabel.text = "Back count: " + backCount;
        }
    }
}
