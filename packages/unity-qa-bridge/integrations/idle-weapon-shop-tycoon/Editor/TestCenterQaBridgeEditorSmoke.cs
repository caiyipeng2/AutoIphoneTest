#if UNITY_EDITOR
using System;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Caiyipeng.TestCenter.IdleWeaponShopTycoon.Editor
{
    /// <summary>
    /// Lets headless validation stop immediately after Unity has compiled the
    /// project. It is editor-only and never ships in an Android player.
    /// </summary>
    public static class TestCenterQaBridgeEditorSmoke
    {
        private const string QaExportPendingKey = "TestCenter.QaBridge.ExportPending";

        [InitializeOnLoadMethod]
        private static void ResumePendingQaExport()
        {
            if (SessionState.GetBool(QaExportPendingKey, false))
                EditorApplication.delayCall += WaitForCompilationThenExport;
        }

        public static void CompileAndExit()
        {
            Debug.Log("TestCenter QA Bridge compile smoke completed.");
            EditorApplication.Exit(0);
        }

        public static void EnableQaSymbolAndExportAndroidProject()
        {
            var group = BuildTargetGroup.Android;
            var symbols = PlayerSettings.GetScriptingDefineSymbolsForGroup(group);
            if (!symbols.Split(';', StringSplitOptions.RemoveEmptyEntries)
                .Contains("UNITY_MULTI_DEVICE_QA", StringComparer.Ordinal))
            {
                PlayerSettings.SetScriptingDefineSymbolsForGroup(
                    group,
                    string.IsNullOrEmpty(symbols) ? "UNITY_MULTI_DEVICE_QA" : symbols + ";UNITY_MULTI_DEVICE_QA");
            }

            // Setting a scripting symbol can reload the editor domain. SessionState
            // survives that reload so the export cannot accidentally run before
            // TestCenter.QaBridge and the game adapter have compiled.
            SessionState.SetBool(QaExportPendingKey, true);
            EditorApplication.delayCall += WaitForCompilationThenExport;
        }

        private static void WaitForCompilationThenExport()
        {
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
            {
                EditorApplication.delayCall += WaitForCompilationThenExport;
                return;
            }

            SessionState.EraseBool(QaExportPendingKey);
            ExportAndroidProject();
        }

        public static void ExportAndroidProject()
        {
            var output = Environment.GetEnvironmentVariable("TEST_CENTER_QA_EXPORT_PATH");
            if (string.IsNullOrWhiteSpace(output)) output = BuildProject.GetFullProjectPath();
            BuildProject.BuildProjectAndroidStudio(output);
            Debug.Log("TestCenter QA Bridge Android project export completed: " + output);
            EditorApplication.Exit(0);
        }

        public static void InstallHybridCLR()
        {
            var installer = new HybridCLR.Editor.Installer.InstallerController();
            installer.InstallDefaultHybridCLR();
            Debug.Log("TestCenter HybridCLR initialization completed.");
            EditorApplication.Exit(0);
        }

        public static void GenerateHybridCLR()
        {
            HybridCLR.Editor.Commands.PrebuildCommand.GenerateAll();
            Debug.Log("TestCenter HybridCLR code generation completed.");
            EditorApplication.Exit(0);
        }
    }
}
#endif
