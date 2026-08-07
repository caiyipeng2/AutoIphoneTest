using NUnit.Framework;

namespace Caiyipeng.TestCenter.QaBridge.Tests
{
    public sealed class QaProtocolTests
    {
        [Test]
        public void DescriptorHashIsStableForEquivalentShapeJson()
        {
            var first = new QaActionDescriptor
            {
                actionType = "tap",
                normalizedShapeJson = "{\"x\":0.5,\"y\":0.25}",
                expectedView = "MainHUD",
                expectedFocus = null,
                metricsEpoch = 12,
            };
            var second = new QaActionDescriptor
            {
                actionType = "tap",
                normalizedShapeJson = "{\"x\":0.5,\"y\":0.25}",
                expectedView = "MainHUD",
                expectedFocus = null,
                metricsEpoch = 12,
            };

            Assert.That(first.ToCanonicalJson(), Is.EqualTo(second.ToCanonicalJson()));
            Assert.That(first.Hash(), Is.EqualTo(second.Hash()));
            Assert.That(first.Hash(), Does.StartWith("sha256:"));
        }

        [Test]
        public void ArmGateConsumesExactlyOnceAndRejectsExpiredOrMismatchedInput()
        {
            var gate = new QaArmGate();
            var request = new QaArmRequest
            {
                actionId = "ACT-1",
                runNonceHash = "sha256:" + new string('c', 64),
                descriptorHash = "sha256:" + new string('a', 64),
                expectedEventShapeHash = "sha256:" + new string('b', 64),
                expectedView = "MainHUD",
                expectedFocus = null,
                metricsEpoch = 4,
                expiresAtRealtimeMs = 100,
            };
            Assert.That(gate.TryArm(request, 10, out var rejection), Is.True);
            Assert.That(rejection, Is.Null);
            Assert.That(gate.TryConsume(new QaObservedInput(request.expectedEventShapeHash, "OtherView", null, 4), "bridge-1", 1, 20, out _, out rejection), Is.False);
            Assert.That(rejection, Is.EqualTo("VIEW_MISMATCH"));
            Assert.That(gate.TryConsume(new QaObservedInput(request.expectedEventShapeHash, "MainHUD", null, 4), "bridge-1", 2, 20, out var acknowledgement, out rejection), Is.True);
            Assert.That(acknowledgement.actionId, Is.EqualTo("ACT-1"));
            Assert.That(rejection, Is.Null);
            Assert.That(gate.TryConsume(new QaObservedInput(request.expectedEventShapeHash, "MainHUD", null, 4), "bridge-1", 3, 20, out _, out rejection), Is.False);
            Assert.That(rejection, Is.EqualTo("ARM_NOT_FOUND"));
            Assert.That(gate.TryArm(request, 101, out rejection), Is.False);
            Assert.That(rejection, Is.EqualTo("INVALID_ARM"));
        }

        [Test]
        public void StatePublisherContainsCoreStateAndCategorizesProviderFailures()
        {
            var publisher = new QaStatePublisher(new IdentityProvider(), new ViewProvider());
            Assert.That(publisher.TryBuild(out var state, out var error, "bridge-1"), Is.True);
            Assert.That(error, Is.Null);
            Assert.That(state.bridgeInstanceId, Is.EqualTo("bridge-1"));
            Assert.That(state.installGeneration, Is.EqualTo(2));
            Assert.That(state.appDataGeneration, Is.EqualTo(3));
            Assert.That(state.stateSeq, Is.EqualTo(1));

            var failing = new QaStatePublisher(new ThrowingIdentityProvider(), new ViewProvider());
            Assert.That(failing.TryBuild(out state, out error, "bridge-2"), Is.False);
            Assert.That(state, Is.Null);
            Assert.That(error.code, Is.EqualTo("STATE_PROVIDER_FAILURE"));
        }

        private sealed class IdentityProvider : IQaIdentityProvider
        {
            public string Uid => "UID-1";
            public int InstallGeneration => 2;
            public int AppDataGeneration => 3;
            public string BuildId => "qa-fixture";
        }

        private sealed class ThrowingIdentityProvider : IQaIdentityProvider
        {
            public string Uid => throw new System.InvalidOperationException("secret");
            public int InstallGeneration => 1;
            public int AppDataGeneration => 1;
            public string BuildId => "qa-fixture";
        }

        private sealed class ViewProvider : IQaViewStateProvider
        {
            public string ViewId => "MainHUD";
            public string FocusedControlId => null;
            public bool TextInputAvailable => false;
        }
    }
}
