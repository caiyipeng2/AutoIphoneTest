# Deployment and signing

APK, APKS, and AAB inputs are imported as immutable artifacts. AAB installation uses Java 17, bundletool 1.18.3, and a configured signing profile. Signing credentials are supplied at runtime and are never stored in the portable directory or manifest.

Unity command-line build integration is available as an opt-in `unity-command` BuildProvider. It runs a configured absolute Unity executable with `shell: false`, imports the generated APK/AAB through the immutable artifact path, and supports cancellation and typed command failures. The default Apps import route remains unchanged; a project-specific Unity arguments builder, signing profile, and real package acceptance are still required before enabling it as a default build workflow.
