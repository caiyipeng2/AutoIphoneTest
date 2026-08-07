#if UNITY_MULTI_DEVICE_QA
using UnityEngine;

namespace Caiyipeng.TestCenter.QaBridge
{
    public sealed class QaInputObserver : MonoBehaviour
    {
        [SerializeField] private QaBridgeBootstrap bridge;

        private void Awake()
        {
            if (bridge == null) bridge = GetComponent<QaBridgeBootstrap>() ?? QaBridgeBootstrap.Instance;
        }

        public bool Observe(string eventShapeHash, string view, string focusedControlId, int metricsEpoch)
        {
            if (bridge == null) bridge = QaBridgeBootstrap.Instance;
            return bridge != null && bridge.Server != null && bridge.Server.ObserveInput(new QaObservedInput(eventShapeHash, view, focusedControlId, metricsEpoch));
        }
    }
}
#endif
