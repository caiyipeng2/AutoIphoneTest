#if UNITY_MULTI_DEVICE_QA
using System;
using UnityEngine;
using Caiyipeng.TestCenter.QaBridge;

namespace Caiyipeng.TestCenter.QaFixture
{
    [DisallowMultipleComponent]
    public sealed class FixtureStateProvider : MonoBehaviour, IQaIdentityProvider, IQaViewStateProvider
    {
        [SerializeField] private FixtureRuntime fixture;
        private string uid;

        public string Uid => uid;
        public int InstallGeneration => 1;
        public int AppDataGeneration => 1;
        public string BuildId => Application.version;
        public string ViewId => fixture != null ? fixture.CurrentView : "MainHUD";
        public string FocusedControlId => fixture != null ? fixture.FocusedControlId : null;
        public bool TextInputAvailable => fixture != null && fixture.TextInputAvailable;

        public void Configure(FixtureRuntime runtime)
        {
            fixture = runtime;
        }

        private void Awake()
        {
            if (fixture == null) fixture = GetComponent<FixtureRuntime>();
            var deviceId = SystemInfo.deviceUniqueIdentifier;
            if (string.IsNullOrWhiteSpace(deviceId)) deviceId = "editor-device";
            uid = "fixture-" + ShortHash(deviceId);
            fixture?.SetIdentity(uid, InstallGeneration, AppDataGeneration, BuildId);
            QaBridgeBootstrap.Configure(this, this);
            if (GetComponent<QaBridgeBootstrap>() == null) gameObject.AddComponent<QaBridgeBootstrap>();
        }

        private static string ShortHash(string value)
        {
            unchecked
            {
                var hash = 17;
                for (var index = 0; index < value.Length; index++) hash = hash * 31 + value[index];
                return Math.Abs(hash).ToString("x8");
            }
        }
    }
}
#endif
