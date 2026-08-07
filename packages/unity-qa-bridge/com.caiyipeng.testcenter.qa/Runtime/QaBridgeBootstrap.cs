#if UNITY_MULTI_DEVICE_QA
using UnityEngine;

namespace Caiyipeng.TestCenter.QaBridge
{
    public sealed class QaBridgeBootstrap : MonoBehaviour
    {
        private static IQaIdentityProvider identityProvider;
        private static IQaViewStateProvider viewStateProvider;
        private QaBridgeServer server;

        public static void Configure(IQaIdentityProvider identity, IQaViewStateProvider view)
        {
            identityProvider = identity;
            viewStateProvider = view;
        }

        public static QaBridgeBootstrap Instance { get; private set; }

        public QaBridgeServer Server => server;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);
            if (identityProvider == null || viewStateProvider == null)
            {
                Debug.LogError("QA bridge providers were not configured; bridge remains disabled.");
                return;
            }
            server = new QaBridgeServer(identityProvider, viewStateProvider);
            server.Start();
        }

        private void Update()
        {
            server?.Update();
        }

        private void OnDestroy()
        {
            if (ReferenceEquals(Instance, this)) Instance = null;
            server?.Dispose();
            server = null;
        }
    }
}
#endif
