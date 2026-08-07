using System;
using UnityEngine;

namespace Caiyipeng.TestCenter.QaBridge
{
    public sealed class QaStatePublisher
    {
        private readonly IQaIdentityProvider identityProvider;
        private readonly IQaViewStateProvider viewStateProvider;
        private Rect lastSafeArea;
        private int lastWidth = -1;
        private int lastHeight = -1;
        private ScreenOrientation lastOrientation = (ScreenOrientation)(-1);
        private bool hasMetrics;
        private int metricsEpoch;
        private long stateSequence;

        public QaStatePublisher(IQaIdentityProvider identityProvider, IQaViewStateProvider viewStateProvider)
        {
            this.identityProvider = identityProvider ?? throw new ArgumentNullException(nameof(identityProvider));
            this.viewStateProvider = viewStateProvider ?? throw new ArgumentNullException(nameof(viewStateProvider));
        }

        public int MetricsEpoch => metricsEpoch;
        public long StateSequence => stateSequence;

        public bool TryBuild(out QaStateMessage state, out QaErrorMessage error, string bridgeInstanceId)
        {
            try
            {
                var safeArea = Screen.safeArea;
                var orientation = Screen.orientation;
                if (!hasMetrics || lastWidth != Screen.width || lastHeight != Screen.height || lastSafeArea != safeArea || lastOrientation != orientation)
                {
                    metricsEpoch++;
                    lastWidth = Screen.width;
                    lastHeight = Screen.height;
                    lastSafeArea = safeArea;
                    lastOrientation = orientation;
                    hasMetrics = true;
                }

                state = new QaStateMessage
                {
                    bridgeInstanceId = bridgeInstanceId,
                    uid = identityProvider.Uid,
                    installGeneration = identityProvider.InstallGeneration,
                    appDataGeneration = identityProvider.AppDataGeneration,
                    buildId = identityProvider.BuildId,
                    width = Screen.width,
                    height = Screen.height,
                    safeArea = new QaSafeArea { x = safeArea.x, y = safeArea.y, width = safeArea.width, height = safeArea.height },
                    orientation = ToOrientation(orientation),
                    metricsEpoch = metricsEpoch,
                    view = viewStateProvider.ViewId,
                    focusedControlId = viewStateProvider.FocusedControlId,
                    textInputAvailable = viewStateProvider.TextInputAvailable,
                    stateSeq = ++stateSequence,
                };
                error = null;
                return true;
            }
            catch (Exception exception)
            {
                state = null;
                error = new QaErrorMessage { bridgeInstanceId = bridgeInstanceId, code = "STATE_PROVIDER_FAILURE", message = exception.GetType().Name };
                return false;
            }
        }

        private static string ToOrientation(ScreenOrientation value)
        {
            if (value == ScreenOrientation.Portrait || value == ScreenOrientation.PortraitUpsideDown) return "Portrait";
            if (value == ScreenOrientation.LandscapeLeft || value == ScreenOrientation.LandscapeRight) return "Landscape";
            return "Unknown";
        }
    }
}
