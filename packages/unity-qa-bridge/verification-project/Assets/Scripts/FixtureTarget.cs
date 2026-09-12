using UnityEngine;
using UnityEngine.EventSystems;
#if UNITY_MULTI_DEVICE_QA
using Caiyipeng.TestCenter.QaBridge;
#endif

namespace Caiyipeng.TestCenter.QaFixture
{
    public sealed class FixtureTarget : MonoBehaviour, IPointerClickHandler, IBeginDragHandler, IEndDragHandler, ISelectHandler, IDeselectHandler
    {
        [SerializeField] private FixtureRuntime fixture;
        [SerializeField] private string controlId = "fixture-target";
        [SerializeField] private string actionType = "tap";
        [SerializeField] private string normalizedShapeJson = "{\"kind\":\"tap\"}";

        public void Configure(FixtureRuntime runtime, string id, string type, string shape)
        {
            fixture = runtime;
            controlId = id;
            actionType = type;
            normalizedShapeJson = shape;
        }

        public void OnPointerClick(PointerEventData eventData)
        {
            if (actionType == "tap") fixture?.RegisterTap(controlId);
            Observe();
        }

        public void OnBeginDrag(PointerEventData eventData)
        {
            if (fixture != null) fixture.SetFocusedControl(controlId);
        }

        public void OnEndDrag(PointerEventData eventData)
        {
            if (actionType == "swipe") fixture?.RegisterSwipe(controlId);
            Observe();
            if (fixture != null) fixture.ClearFocusedControl(controlId);
        }

        public void OnSelect(BaseEventData eventData)
        {
            if (fixture != null) fixture.SetFocusedControl(controlId);
        }

        public void OnDeselect(BaseEventData eventData)
        {
            if (fixture != null) fixture.ClearFocusedControl(controlId);
        }

        private void Observe()
        {
#if UNITY_MULTI_DEVICE_QA
            if (fixture == null) return;
            var descriptor = new QaActionDescriptor
            {
                actionType = actionType,
                normalizedShapeJson = normalizedShapeJson,
                expectedView = fixture.CurrentView,
                expectedFocus = fixture.FocusedControlId,
                metricsEpoch = fixture.MetricsEpoch,
            };
            var observer = GetComponentInParent<QaInputObserver>();
            if (observer == null) observer = FindObjectOfType<QaInputObserver>();
            observer?.Observe(descriptor.Hash(), fixture.CurrentView, fixture.FocusedControlId, fixture.MetricsEpoch);
#endif
        }
    }
}
