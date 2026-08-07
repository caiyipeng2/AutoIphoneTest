using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditor.Build.Reporting;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.SceneManagement;
using UnityEngine.UI;
using Caiyipeng.TestCenter.QaFixture;

namespace Caiyipeng.TestCenter.QaFixture.Editor
{
    public static class QaFixtureBuilder
    {
        public const string ScenePath = "Assets/Scenes/QaFixture.unity";
        private const string PackageId = "com.caiyipeng.testcenter.fixture";

        [MenuItem("Test Center/Build QA Fixture Scene")]
        public static void BuildFixtureSceneMenu()
        {
            BuildFixtureScene();
            Debug.Log("QA fixture scene created at " + ScenePath);
        }

        public static void BuildFromCommandLine()
        {
            var outputPath = Argument("-buildPath");
            if (string.IsNullOrWhiteSpace(outputPath))
            {
                Debug.LogError("Missing -buildPath for QA fixture build.");
                EditorApplication.Exit(2);
                return;
            }

            BuildFixtureScene();
            PlayerSettings.SetApplicationIdentifier(BuildTargetGroup.Android, PackageId);
            PlayerSettings.productName = "Test Center QA Fixture";
            PlayerSettings.companyName = "Test Center";
            PlayerSettings.bundleVersion = "0.1.0";

            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = outputPath,
                target = BuildTarget.Android,
                targetGroup = BuildTargetGroup.Android,
                options = BuildOptions.StrictMode,
            };
            var report = BuildPipeline.BuildPlayer(options);
            if (report.summary.result != BuildResult.Succeeded)
            {
                Debug.LogError($"Fixture build failed: {report.summary.result}; errors={report.summary.totalErrors}");
                EditorApplication.Exit(1);
                return;
            }

            Debug.Log($"Fixture build succeeded: {outputPath}; size={report.summary.totalSize}");
            EditorApplication.Exit(0);
        }

        public static void BuildFixtureScene()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var eventSystem = new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
            SceneManager.MoveGameObjectToScene(eventSystem, scene);

            var root = new GameObject("FixtureRuntime");
            SceneManager.MoveGameObjectToScene(root, scene);
            var fixture = root.AddComponent<FixtureRuntime>();
#if UNITY_MULTI_DEVICE_QA
            var provider = root.AddComponent<FixtureStateProvider>();
            provider.Configure(fixture);
            root.AddComponent<Caiyipeng.TestCenter.QaBridge.QaInputObserver>();
#endif

            var canvasObject = new GameObject("Canvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            SceneManager.MoveGameObjectToScene(canvasObject, scene);
            var canvas = canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasObject.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1080, 1920);
            scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
            scaler.matchWidthOrHeight = 0.5f;

            var title = CreateText(canvasObject.transform, "Title", "Idle Weapon Shop Tycoon - QA Fixture", 42, new Vector2(0, 820), new Vector2(900, 90), Color.white);
            var uid = CreateText(canvasObject.transform, "Uid", "UID: pending", 30, new Vector2(0, 710), new Vector2(900, 60), new Color(0.65f, 0.9f, 1f));
            var generation = CreateText(canvasObject.transform, "Generation", "Install generation: pending", 24, new Vector2(0, 640), new Vector2(980, 60), Color.white);
            var metrics = CreateText(canvasObject.transform, "Metrics", "View: MainHUD | Focus: none | Metrics epoch: 0", 25, new Vector2(0, 555), new Vector2(1000, 70), new Color(0.8f, 0.9f, 1f));
            var action = CreateText(canvasObject.transform, "Action", "Last action: none", 26, new Vector2(0, 465), new Vector2(980, 70), Color.white);
            var back = CreateText(canvasObject.transform, "Back", "Back count: 0", 26, new Vector2(0, 385), new Vector2(900, 60), Color.white);

            var tap = CreateTarget(canvasObject.transform, fixture, "TapTarget100", "Tap target (100 px)", "tap", "{\"kind\":\"tap\",\"target\":\"TapTarget100\"}", new Vector2(-250, 170), new Color(0.16f, 0.48f, 0.8f));
            var swipe = CreateTarget(canvasObject.transform, fixture, "SwipeLane", "Swipe lane", "swipe", "{\"kind\":\"swipe\",\"axis\":\"vertical\",\"lane\":\"SwipeLane\"}", new Vector2(250, 170), new Color(0.2f, 0.58f, 0.42f));
            SetSize(tap.GetComponent<RectTransform>(), new Vector2(100, 100));
            SetSize(swipe.GetComponent<RectTransform>(), new Vector2(100, 420));

            var input = CreateInputField(canvasObject.transform, fixture, new Vector2(0, -250));
            var hint = CreateText(canvasObject.transform, "Hint", "Tap, swipe, focus text, or press Back on the fixture device", 23, new Vector2(0, -650), new Vector2(1000, 80), new Color(0.72f, 0.78f, 0.84f));
            fixture.Configure(uid, generation, metrics, action, back, input);

            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.SaveAssets();
        }

        private static GameObject CreateTarget(Transform parent, FixtureRuntime fixture, string id, string label, string type, string shape, Vector2 position, Color color)
        {
            var target = new GameObject(id, typeof(RectTransform), typeof(Image), typeof(FixtureTarget));
            target.transform.SetParent(parent, false);
            var rect = target.GetComponent<RectTransform>();
            rect.anchorMin = new Vector2(0.5f, 0.5f);
            rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = position;
            rect.sizeDelta = new Vector2(100, 100);
            target.GetComponent<Image>().color = color;
            var text = CreateText(target.transform, "Label", label, 22, Vector2.zero, new Vector2(260, 90), Color.white);
            text.resizeTextForBestFit = true;
            target.GetComponent<FixtureTarget>().Configure(fixture, id, type, shape);
            return target;
        }

        private static InputField CreateInputField(Transform parent, FixtureRuntime fixture, Vector2 position)
        {
            var inputObject = new GameObject("FixtureInput", typeof(RectTransform), typeof(Image), typeof(InputField), typeof(FixtureTarget));
            inputObject.transform.SetParent(parent, false);
            var rect = inputObject.GetComponent<RectTransform>();
            rect.anchorMin = new Vector2(0.5f, 0.5f);
            rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = position;
            rect.sizeDelta = new Vector2(650, 95);
            inputObject.GetComponent<Image>().color = new Color(0.12f, 0.16f, 0.22f);
            var input = inputObject.GetComponent<InputField>();
            input.contentType = InputField.ContentType.Standard;
            input.lineType = InputField.LineType.SingleLine;
            var text = CreateText(inputObject.transform, "Text", string.Empty, 28, Vector2.zero, new Vector2(600, 80), Color.white);
            text.alignment = TextAnchor.MiddleLeft;
            var placeholder = CreateText(inputObject.transform, "Placeholder", "Text input focus target", 28, Vector2.zero, new Vector2(600, 80), new Color(0.5f, 0.55f, 0.6f));
            placeholder.alignment = TextAnchor.MiddleLeft;
            input.textComponent = text;
            input.placeholder = placeholder;
            inputObject.GetComponent<FixtureTarget>().Configure(fixture, "fixture-input", "text", "{\"kind\":\"text\",\"control\":\"fixture-input\"}");
            return input;
        }

        private static Text CreateText(Transform parent, string name, string value, int fontSize, Vector2 position, Vector2 size, Color color)
        {
            var objectValue = new GameObject(name, typeof(RectTransform), typeof(Text));
            objectValue.transform.SetParent(parent, false);
            var rect = objectValue.GetComponent<RectTransform>();
            rect.anchorMin = new Vector2(0.5f, 0.5f);
            rect.anchorMax = new Vector2(0.5f, 0.5f);
            rect.anchoredPosition = position;
            rect.sizeDelta = size;
            var text = objectValue.GetComponent<Text>();
            text.text = value;
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = fontSize;
            text.color = color;
            text.alignment = TextAnchor.MiddleCenter;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            return text;
        }

        private static void SetSize(RectTransform rect, Vector2 size)
        {
            rect.sizeDelta = size;
        }

        private static string Argument(string name)
        {
            var args = Environment.GetCommandLineArgs();
            for (var index = 0; index < args.Length - 1; index++)
            {
                if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
            }
            return null;
        }
    }
}
