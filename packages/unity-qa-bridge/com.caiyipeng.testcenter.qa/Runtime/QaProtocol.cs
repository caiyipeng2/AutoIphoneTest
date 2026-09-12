using System;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Caiyipeng.TestCenter.QaBridge
{
    [Serializable]
    public sealed class QaHelloMessage
    {
        public string type = "QA_HELLO";
        public int schemaVersion = 1;
        public string bridgeInstanceId;
        public string bootId;
        public string buildId;
    }

    [Serializable]
    public sealed class QaStateMessage
    {
        public string type = "QA_STATE";
        public int schemaVersion = 1;
        public string bridgeInstanceId;
        public string uid;
        public int installGeneration;
        public int appDataGeneration;
        public string buildId;
        public int width;
        public int height;
        public float[] safeArea;
        public string orientation;
        public int metricsEpoch;
        public string view;
        public string focusedControlId;
        public bool textInputAvailable;
        public long stateSeq;
    }

    [Serializable]
    public sealed class QaActionDescriptor
    {
        public string actionType;
        public string normalizedShapeJson;
        public string expectedView;
        public string expectedFocus;
        public int metricsEpoch;

        public string ToCanonicalJson()
        {
            return "{\"actionType\":\"" + Escape(actionType) +
                   "\",\"expectedFocus\":" + NullableString(expectedFocus) +
                   ",\"expectedView\":\"" + Escape(expectedView) +
                   "\",\"metricsEpoch\":" + metricsEpoch +
                   ",\"normalizedShape\":" + (string.IsNullOrEmpty(normalizedShapeJson) ? "null" : normalizedShapeJson) + "}";
        }

        public string Hash()
        {
            using (var sha = SHA256.Create())
            {
                var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(ToCanonicalJson()));
                var builder = new StringBuilder("sha256:");
                for (var index = 0; index < bytes.Length; index++) builder.Append(bytes[index].ToString("x2"));
                return builder.ToString();
            }
        }

        private static string NullableString(string value)
        {
            return value == null ? "null" : "\"" + Escape(value) + "\"";
        }

        private static string Escape(string value)
        {
            if (value == null) return string.Empty;
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
        }
    }

    [Serializable]
    public sealed class QaArmRequest
    {
        public string type = "QA_ARM";
        public int schemaVersion = 1;
        public string runNonceHash;
        public string actionId;
        public string descriptorHash;
        public string expectedEventShapeHash;
        public string expectedView;
        public string expectedFocus;
        public int metricsEpoch;
        public string expiresAtRealtimeMs;

        public bool TryGetExpiresAtRealtimeMs(out long value)
        {
            return long.TryParse(expiresAtRealtimeMs, NumberStyles.None, CultureInfo.InvariantCulture, out value);
        }
    }

    [Serializable]
    public sealed class QaDisarmRequest
    {
        public string type = "QA_DISARM";
        public int schemaVersion = 1;
        public string actionId;
    }

    [Serializable]
    public sealed class QaArmedMessage
    {
        public string type = "QA_ARMED";
        public int schemaVersion = 1;
        public string bridgeInstanceId;
        public string runNonceHash;
        public string actionId;
        public string descriptorHash;
        public string expectedEventShapeHash;
        public string expectedView;
        public string expectedFocus;
        public int metricsEpoch;
        public string expiresAtRealtimeMs;
    }

    [Serializable]
    public sealed class QaAckMessage
    {
        public string type = "QA_ACK";
        public int schemaVersion = 1;
        public string bridgeInstanceId;
        public string actionId;
        public string observedAtRealtimeNs;
        public string descriptorHash;
        public string eventShapeHash;
        public string view;
        public string focusedControlId;
        public int metricsEpoch;
        public long stateSeq;
    }

    [Serializable]
    public sealed class QaRejectedMessage
    {
        public string type = "QA_REJECTED";
        public int schemaVersion = 1;
        public string bridgeInstanceId;
        public string actionId;
        public string code;
        public string reason;
    }

    [Serializable]
    public sealed class QaPongMessage
    {
        public string type = "QA_PONG";
        public int schemaVersion = 1;
        public string bridgeInstanceId;
        public string pingId;
        public string observedAtRealtimeNs;
    }

    [Serializable]
    public sealed class QaPingRequest
    {
        public string type = "QA_PING";
        public int schemaVersion = 1;
        public string pingId;
    }

    [Serializable]
    public sealed class QaErrorMessage
    {
        public string type = "QA_ERROR";
        public int schemaVersion = 1;
        public string bridgeInstanceId;
        public string code;
        public string message;
    }

    public readonly struct QaObservedInput
    {
        public QaObservedInput(string eventShapeHash, string view, string focusedControlId, int metricsEpoch)
        {
            EventShapeHash = eventShapeHash;
            View = view;
            FocusedControlId = focusedControlId;
            MetricsEpoch = metricsEpoch;
        }

        public string EventShapeHash { get; }
        public string View { get; }
        public string FocusedControlId { get; }
        public int MetricsEpoch { get; }
    }

    public sealed class QaArmGate
    {
        private QaArmRequest active;

        public string ActiveActionId => active?.actionId;

        public bool TryArm(QaArmRequest request, long nowRealtimeMs, out string rejectionCode)
        {
            rejectionCode = null;
            if (request == null || request.schemaVersion != 1 || string.IsNullOrEmpty(request.actionId) || string.IsNullOrEmpty(request.runNonceHash) || !request.TryGetExpiresAtRealtimeMs(out var expiresAtRealtimeMs) || expiresAtRealtimeMs <= nowRealtimeMs)
            {
                rejectionCode = "INVALID_ARM";
                return false;
            }
            if (active != null && active.TryGetExpiresAtRealtimeMs(out var activeExpiry) && activeExpiry > nowRealtimeMs)
            {
                rejectionCode = "ARM_BUSY";
                return false;
            }
            active = request;
            return true;
        }

        public bool TryConsume(QaObservedInput observed, string bridgeInstanceId, long stateSeq, long nowRealtimeMs, out QaAckMessage acknowledgement, out string rejectionCode)
        {
            acknowledgement = null;
            rejectionCode = null;
            if (active == null)
            {
                rejectionCode = "ARM_NOT_FOUND";
                return false;
            }
            if (!active.TryGetExpiresAtRealtimeMs(out var activeExpiry) || activeExpiry <= nowRealtimeMs)
            {
                active = null;
                rejectionCode = "ARM_EXPIRED";
                return false;
            }
            if (active.expectedEventShapeHash != observed.EventShapeHash) { rejectionCode = "EVENT_SHAPE_MISMATCH"; return false; }
            if (active.expectedView != observed.View) { rejectionCode = "VIEW_MISMATCH"; return false; }
            if ((active.expectedFocus ?? string.Empty) != (observed.FocusedControlId ?? string.Empty)) { rejectionCode = "FOCUS_MISMATCH"; return false; }
            if (active.metricsEpoch != observed.MetricsEpoch) { rejectionCode = "METRICS_EPOCH_MISMATCH"; return false; }
            acknowledgement = new QaAckMessage
            {
                bridgeInstanceId = bridgeInstanceId,
                actionId = active.actionId,
                observedAtRealtimeNs = (nowRealtimeMs * 1000000L).ToString(System.Globalization.CultureInfo.InvariantCulture),
                descriptorHash = active.descriptorHash,
                eventShapeHash = observed.EventShapeHash,
                view = observed.View,
                focusedControlId = observed.FocusedControlId,
                metricsEpoch = observed.MetricsEpoch,
                stateSeq = stateSeq,
            };
            active = null;
            return true;
        }

        public void Clear()
        {
            active = null;
        }
    }

    internal static class QaClock
    {
        public static long RealtimeMilliseconds()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            try
            {
                using (var clock = new UnityEngine.AndroidJavaClass("android.os.SystemClock"))
                {
                    return clock.CallStatic<long>("elapsedRealtime");
                }
            }
            catch (Exception)
            {
                // Fall through to the process monotonic clock when the Android API is unavailable.
            }
#endif
            return (long)(UnityEngine.Time.realtimeSinceStartup * 1000.0f);
        }

        public static long RealtimeNanoseconds()
        {
            return RealtimeMilliseconds() * 1000000L;
        }
    }
}
