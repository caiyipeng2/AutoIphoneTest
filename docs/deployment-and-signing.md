# Deployment and signing

APK, APKS, and AAB inputs are imported as immutable artifacts. AAB installation uses Java 17, bundletool 1.18.3, and a configured signing profile. Signing credentials are supplied at runtime and are never stored in the portable directory or manifest.

Unity command-line build integration is intentionally not implemented in this release. BuildProvider remains the extension point for a future provider.
