# TubbyBuddy for Android

Kotlin. The app shows the same screens as the web app in a WebView, loaded from the server, and adds the native parts:
a guard service that notices when a guarded app comes to the front, the full-screen block screen, permissions and an
installed-app picker. **Put it down** keeps your points and streak; **Continue anyway** burns 25% of them (double in
hard mode). There are no AI keys in the app.

Build: `./gradlew testDebugUnitTest lintDebug assembleDebug` (or `./build.sh`). Output: `app/build/outputs/apk/`.
The APK uses the hosted server; add `-Pburn.backendUrl=http://localhost:8787` (with `adb reverse tcp:8787 tcp:8787`)
for a local one. Release signing reads a keystore properties file from outside the repo (`-Pburn.keystoreProps=` or
`BURN_KEYSTORE_PROPS`).

More: [../docs/01-ARCHITECTURE.md](../docs/01-ARCHITECTURE.md) and [../docs/04-SETUP-AND-RUN.md](../docs/04-SETUP-AND-RUN.md).
