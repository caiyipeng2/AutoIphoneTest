# Maintenance

Keep the release directory intact when upgrading. Verify `manifest.sha256.json` after copying it to another E-drive folder. To roll back, stop the launcher and restore the previous verified directory. Do not copy `data/test-center.sqlite`, imported runs, or signing material between releases unless the operator has reviewed the retention and privacy impact.

The repository workflow is: implement locally, run tests and device acceptance, obtain operator confirmation, then commit and push to the configured remote.
