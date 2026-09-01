#if UNITY_MULTI_DEVICE_QA
using System;
using System.Globalization;
using System.Reflection;
using Caiyipeng.TestCenter.QaBridge;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.SceneManagement;

namespace Caiyipeng.TestCenter.IdleWeaponShopTycoon
{
    /// <summary>
    /// Reads the currently logged-in UID without coupling the shared QA package
    /// to the game's hotfix assembly. Before login the bridge reports null, which
    /// keeps the host from mistaking a placeholder for a trusted account UID.
    /// </summary>
    internal sealed class IdleWeaponShopQaIdentityProvider : IQaIdentityProvider
    {
        private const string InstallGenerationKey = "TestCenter.InstallGeneration";
        private const string AppDataGenerationKey = "TestCenter.AppDataGeneration";

        public string Uid => ReadUid();

        public int InstallGeneration => ReadPositivePlayerPref(InstallGenerationKey);

        public int AppDataGeneration => ReadPositivePlayerPref(AppDataGenerationKey);

        public string BuildId
        {
            get
            {
                var identifier = string.IsNullOrEmpty(Application.identifier)
                    ? "idle-weapon-shop-tycoon"
                    : Application.identifier;
                var version = string.IsNullOrEmpty(Application.version) ? "unknown" : Application.version;
                return identifier + "@" + version;
            }
        }

        private static int ReadPositivePlayerPref(string key)
        {
            return Mathf.Max(1, PlayerPrefs.GetInt(key, 1));
        }

        private static string ReadUid()
        {
            try
            {
                var account = ReadStaticMember("GameEntity", "Account");
                var accountInfo = ReadInstanceMember(account, "AccountInfo");
                var uid = ReadInstanceMember(accountInfo, "Uid");
                return uid?.ToString();
            }
            catch (Exception)
            {
                // Identity is optional during startup; a provider failure must not
                // stop the game or make the bridge claim a synthetic UID.
                return null;
            }
        }

        private static object ReadStaticMember(string typeName, string memberName)
        {
            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                var type = assembly.GetType(typeName, false);
                if (type == null) continue;
                var property = type.GetProperty(memberName, BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                if (property != null) return property.GetValue(null, null);
                var field = type.GetField(memberName, BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                if (field != null) return field.GetValue(null);
            }
            return null;
        }

        private static object ReadInstanceMember(object target, string memberName)
        {
            if (target == null) return null;
            var type = target.GetType();
            var property = type.GetProperty(memberName, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            if (property != null) return property.GetValue(target, null);
            var field = type.GetField(memberName, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            return field?.GetValue(target);
        }
    }

    /// <summary>
    /// Supplies stable, non-gameplay view metadata. Game-specific screens can
    /// replace this adapter later without changing the host bridge protocol.
    /// </summary>
    internal sealed class IdleWeaponShopQaViewStateProvider : IQaViewStateProvider
    {
        public string ViewId
        {
            get
            {
                var scene = SceneManager.GetActiveScene();
                return string.IsNullOrEmpty(scene.name) ? "Unknown" : scene.name;
            }
        }

        public string FocusedControlId
        {
            get
            {
                var selected = EventSystem.current?.currentSelectedGameObject;
                return selected == null ? null : selected.name;
            }
        }

        public bool TextInputAvailable
        {
            get
            {
                var selected = EventSystem.current?.currentSelectedGameObject;
                if (selected == null) return false;
                var inputField = selected.GetComponent("InputField");
                var tmpInputField = selected.GetComponent("TMP_InputField");
                return inputField != null || tmpInputField != null;
            }
        }
    }

    /// <summary>
    /// Receives observations from game-owned UI callbacks. It never clicks a
    /// control or mutates game state; the game remains the sole source of input.
    /// </summary>
    internal sealed class IdleWeaponShopQaInputRelay : MonoBehaviour
    {
        private QaInputObserver observer;
        private IdleWeaponShopQaViewStateProvider viewState;

        private void Awake()
        {
            observer = GetComponent<QaInputObserver>() ?? gameObject.AddComponent<QaInputObserver>();
            viewState = new IdleWeaponShopQaViewStateProvider();
        }

        private void Update()
        {
            // Observe the first frame of a real touch after the game input system
            // receives it. This never sends input back to Unity or invokes a
            // Button; it only lets an already-armed host action be acknowledged.
            if (Input.touchCount != 1) return;
            var touch = Input.GetTouch(0);
            if (touch.phase == TouchPhase.Began) ObservePointerPosition(touch.position);
        }

        private void ObservePointerPosition(Vector2 position)
        {
            var width = Mathf.Max(2f, Screen.width - 1f);
            var height = Mathf.Max(2f, Screen.height - 1f);
            var normalizedX = QuantizeCoordinate(Mathf.Clamp01(position.x / width));
            var normalizedY = QuantizeCoordinate(Mathf.Clamp01((Screen.height - 1f - position.y) / height));
            var shape = "{\"type\":\"tap\",\"x\":" + FormatCoordinate(normalizedX) +
                        ",\"y\":" + FormatCoordinate(normalizedY) + "}";
            Observe("tap", shape);
        }

        private static float QuantizeCoordinate(float value)
        {
            return Mathf.Round(value * 1000f) / 1000f;
        }

        private static string FormatCoordinate(float value)
        {
            return value.ToString("0.###", CultureInfo.InvariantCulture);
        }

        public bool Observe(string actionType, string normalizedShapeJson)
        {
            var bridge = QaBridgeBootstrap.Instance;
            var server = bridge?.Server;
            if (server == null) return false;
            var view = viewState.ViewId;
            var focus = viewState.FocusedControlId;
            var descriptor = new QaActionDescriptor
            {
                actionType = actionType,
                normalizedShapeJson = normalizedShapeJson,
                expectedView = view,
                expectedFocus = focus,
                metricsEpoch = server.MetricsEpoch,
            };
            return observer.Observe(descriptor.Hash(), view, focus, server.MetricsEpoch);
        }
    }

    /// <summary>
    /// Creates the QA-only bridge before the first scene. The release build sees
    /// none of these types because every declaration is guarded by the QA symbol.
    /// </summary>
    public static class IdleWeaponShopQaBridgeRuntime
    {
        private const string RootName = "TestCenter QA Bridge";
        private static IdleWeaponShopQaInputRelay relay;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Initialize()
        {
            if (QaBridgeBootstrap.Instance != null) return;

            var root = new GameObject(RootName);
            UnityEngine.Object.DontDestroyOnLoad(root);
            QaBridgeBootstrap.Configure(new IdleWeaponShopQaIdentityProvider(), new IdleWeaponShopQaViewStateProvider());
            root.AddComponent<QaBridgeBootstrap>();
            relay = root.AddComponent<IdleWeaponShopQaInputRelay>();
        }

        /// <summary>
        /// Lets a game-owned EventSystem callback correlate an already-observed
        /// event. The normalized shape must match the host action descriptor.
        /// </summary>
        public static bool ObserveInput(string actionType, string normalizedShapeJson)
        {
            return relay != null && relay.Observe(actionType, normalizedShapeJson);
        }
    }
}
#endif
