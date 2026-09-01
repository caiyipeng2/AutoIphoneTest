#if UNITY_MULTI_DEVICE_QA
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using UnityEngine;

namespace Caiyipeng.TestCenter.QaBridge
{
    public sealed class QaBridgeServer : IDisposable
    {
        public const int DefaultDevicePort = 17501;
        private const int MaxLineLength = 16 * 1024;
        private readonly object connectionGate = new object();
        private readonly ConcurrentQueue<string> inbound = new ConcurrentQueue<string>();
        private readonly QaStatePublisher statePublisher;
        private readonly string bridgeInstanceId = "bridge-" + Guid.NewGuid().ToString("N");
        private readonly string bootId = "boot-" + Guid.NewGuid().ToString("N");
        private readonly string buildId;
        private readonly int devicePort;
        private TcpListener listener;
        private TcpClient client;
        private StreamWriter writer;
        private Thread acceptThread;
        private bool running;
        private bool helloSent;
        private float nextStateAt;
        private readonly QaArmGate armGate = new QaArmGate();

        [Serializable]
        private sealed class MessageEnvelope
        {
            public string type;
        }

        public QaBridgeServer(IQaIdentityProvider identityProvider, IQaViewStateProvider viewStateProvider, int devicePort = DefaultDevicePort)
        {
            statePublisher = new QaStatePublisher(identityProvider, viewStateProvider);
            buildId = identityProvider.BuildId;
            this.devicePort = devicePort;
        }

        public string BridgeInstanceId => bridgeInstanceId;
        public bool IsConnected { get; private set; }
        public int MetricsEpoch => statePublisher.MetricsEpoch;

        public static QaPongMessage CreatePongMessage(string bridgeInstanceId, string pingId, long observedAtRealtimeNs)
        {
            return new QaPongMessage
            {
                bridgeInstanceId = bridgeInstanceId,
                pingId = pingId,
                observedAtRealtimeNs = observedAtRealtimeNs.ToString(System.Globalization.CultureInfo.InvariantCulture),
            };
        }

        public void Start()
        {
            if (running) return;
            listener = new TcpListener(IPAddress.Loopback, devicePort);
            listener.Start(1);
            running = true;
            acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "TestCenter.QaBridge.Accept" };
            acceptThread.Start();
        }

        public void Update()
        {
            if (!running) return;
            if (IsConnected && !helloSent)
            {
                Send(new QaHelloMessage { bridgeInstanceId = bridgeInstanceId, bootId = bootId, buildId = buildId });
                helloSent = true;
                nextStateAt = 0f;
            }
            while (inbound.TryDequeue(out var line)) HandleLine(line);
            if (IsConnected && Time.realtimeSinceStartup >= nextStateAt)
            {
                PublishState();
                nextStateAt = Time.realtimeSinceStartup + 0.25f;
            }
        }

        public bool ObserveInput(QaObservedInput observed)
        {
            var actionId = armGate.ActiveActionId;
            if (armGate.TryConsume(observed, bridgeInstanceId, statePublisher.StateSequence, QaClock.RealtimeMilliseconds(), out var acknowledgement, out var rejectionCode))
            {
                Send(acknowledgement);
                return true;
            }
            if (rejectionCode != null) Reject(actionId, rejectionCode);
            return false;
        }

        public void Dispose()
        {
            running = false;
            listener?.Stop();
            lock (connectionGate) CloseClient();
            if (acceptThread != null && acceptThread.IsAlive) acceptThread.Join(250);
            acceptThread = null;
        }

        private void AcceptLoop()
        {
            try
            {
                while (running)
                {
                    var accepted = listener.AcceptTcpClient();
                    lock (connectionGate)
                    {
                        CloseClient();
                        client = accepted;
                        writer = new StreamWriter(client.GetStream(), new UTF8Encoding(false)) { AutoFlush = true };
                        IsConnected = true;
                        helloSent = false;
                    }
                    ReadLoop(accepted);
                }
            }
            catch (SocketException) when (!running) { }
            catch (ObjectDisposedException) when (!running) { }
        }

        private void ReadLoop(TcpClient accepted)
        {
            try
            {
                using (var reader = new StreamReader(accepted.GetStream(), new UTF8Encoding(false)))
                {
                    while (running && accepted.Connected)
                    {
                        var line = ReadBoundedLine(reader);
                        if (line == null) break;
                        inbound.Enqueue(line);
                    }
                }
            }
            catch (IOException) { }
            catch (InvalidDataException) { }
            finally
            {
                lock (connectionGate)
                {
                    if (ReferenceEquals(client, accepted))
                    {
                        CloseClient();
                        armGate.Clear();
                    }
                }
            }
        }

        private void HandleLine(string line)
        {
            MessageEnvelope envelope;
            try { envelope = JsonUtility.FromJson<MessageEnvelope>(line); }
            catch (Exception) { Reject(null, "MESSAGE_INVALID_JSON"); return; }
            if (envelope == null || string.IsNullOrEmpty(envelope.type))
            {
                Reject(null, "MESSAGE_UNSUPPORTED");
                return;
            }

            if (envelope.type == "QA_PING")
            {
                QaPingRequest request;
                try { request = JsonUtility.FromJson<QaPingRequest>(line); }
                catch (Exception) { Reject(null, "INVALID_PING"); return; }
                if (request == null || request.schemaVersion != 1 || string.IsNullOrEmpty(request.pingId))
                {
                    Reject(request?.pingId, "INVALID_PING");
                    return;
                }
                Send(CreatePongMessage(bridgeInstanceId, request.pingId, QaClock.RealtimeNanoseconds()));
                return;
            }

            if (envelope.type == "QA_ARM")
            {
                QaArmRequest request;
                try { request = JsonUtility.FromJson<QaArmRequest>(line); }
                catch (Exception) { Reject(null, "INVALID_ARM"); return; }
                if (request == null || request.schemaVersion != 1 || string.IsNullOrEmpty(request.actionId) || string.IsNullOrEmpty(request.runNonceHash) || !request.TryGetExpiresAtRealtimeMs(out var expiresAtRealtimeMs) || expiresAtRealtimeMs <= QaClock.RealtimeMilliseconds())
                {
                    Reject(request?.actionId, "INVALID_ARM");
                    return;
                }
                if (!armGate.TryArm(request, QaClock.RealtimeMilliseconds(), out var rejectionCode))
                {
                    Reject(request.actionId, rejectionCode);
                    return;
                }
                Send(new QaArmedMessage
                {
                    bridgeInstanceId = bridgeInstanceId,
                    runNonceHash = request.runNonceHash,
                    actionId = request.actionId,
                    descriptorHash = request.descriptorHash,
                    expectedEventShapeHash = request.expectedEventShapeHash,
                    expectedView = request.expectedView,
                    expectedFocus = request.expectedFocus,
                    metricsEpoch = request.metricsEpoch,
                    expiresAtRealtimeMs = request.expiresAtRealtimeMs,
                });
                return;
            }
            if (envelope.type == "QA_DISARM")
            {
                try
                {
                    var request = JsonUtility.FromJson<QaDisarmRequest>(line);
                    armGate.Clear();
                }
                catch (Exception) { Reject(null, "INVALID_DISARM"); }
                return;
            }
            Reject(null, "MESSAGE_UNSUPPORTED");
        }

        private void PublishState()
        {
            if (statePublisher.TryBuild(out var state, out var error, bridgeInstanceId)) Send(state);
            else Send(error);
        }

        private void Reject(string actionId, string code)
        {
            Send(new QaRejectedMessage { bridgeInstanceId = bridgeInstanceId, actionId = actionId, code = code, reason = code });
        }

        private void Send(object message)
        {
            lock (connectionGate)
            {
                if (writer == null) return;
                try
                {
                    // Unity JsonUtility serializes null strings as empty strings,
                    // while the host schema distinguishes nullable fields from
                    // invalid empty identifiers. Normalize only the two fields
                    // whose protocol contract explicitly permits null.
                    var json = NormalizeNullableBridgeFields(JsonUtility.ToJson(message));
                    writer.WriteLine(json);
                }
                catch (IOException) { CloseClient(); }
            }
        }

        private static string NormalizeNullableBridgeFields(string json)
        {
            if (string.IsNullOrEmpty(json)) return json;
            return json
                .Replace("\"uid\":\"\"", "\"uid\":null")
                .Replace("\"focusedControlId\":\"\"", "\"focusedControlId\":null")
                .Replace("\"expectedFocus\":\"\"", "\"expectedFocus\":null");
        }

        private void CloseClient()
        {
            IsConnected = false;
            helloSent = false;
            writer?.Dispose();
            writer = null;
            client?.Close();
            client = null;
        }

        private static string ReadBoundedLine(StreamReader reader)
        {
            var builder = new StringBuilder();
            while (builder.Length <= MaxLineLength)
            {
                var value = reader.Read();
                if (value < 0) return builder.Length == 0 ? null : builder.ToString();
                if (value == '\n') return builder.ToString().TrimEnd('\r');
                builder.Append((char)value);
            }
            throw new InvalidDataException("QA bridge line exceeded the maximum length.");
        }
    }
}
#endif
