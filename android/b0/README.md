# Android DSH shell

Android WebView shell for official `@deepseek-ai/dsh@0.2.1-alpha.2`. Module `:b0`,
applicationId `com.jarvis.life.b0`, Kotlin namespace `com.jarvis.b0`. These identities
and the existing version metadata are retained for install compatibility.

## Connection and account

Enter your Host, for example `https://dsh.example.com/`. Remote origins require trusted
HTTPS; only the explicitly supported loopback/emulator addresses permit HTTP for development.
The shell provides a server picker, password login and password change through the
[login contract](../../contracts/login.md). DSH owns Cookie authentication and all
chat, model, tool, HTTP, WebSocket and file protocols. No launch token is stored in the APK.
Switching servers or logging out invalidates old page callbacks and clears WebView Cookies.
Network recovery never resends a draft or automatically invokes a model.

Account, server and connection/file status pages are reached through the mobile-ui plugin's
three fixed settings messages. System Back first closes native settings, then delegates to
`window.__JARVIS_B0_MOBILE__.back()`, then applies the existing browser/task behavior.
External links require confirmation. Renderer crashes invalidate stale callbacks before recovery.
Microphone and location access require foreground, same-origin permission checks.

## Session notifications

The independent [session-notify plugin](../../plugins/session-notify/README.md) supplies an
authenticated SSE stream. A foreground service maintains the connection, with an Android
“保持连接” status notification. Reply, failure, approval and question events follow the
[notification contract](../../contracts/session-notify.md), including epoch/cursor recovery,
local viewing suppression, per-session grouping and lock-screen privacy.
Tapping a notification opens its Host-bound Session after the mobile plugin becomes ready;
the wait is bounded to 10 seconds. Logout and Host switching stop the old connection.

Android 13+ notification permission is requested in the foreground on initial enablement or
re-enablement. Denial does not cause a repeated prompt loop. Required manifest capabilities
include POST_NOTIFICATIONS, ACCESS_NETWORK_STATE and foreground-service permissions.
There is no alarm scheduler, boot receiver, daily overview or life API polling.
Android battery policy, force-stop and notification settings can interrupt delivery; actual
device/background behavior must be checked separately from unit tests.

## File export

The [file-export plugin](../../plugins/file-export/README.md) adds “保存到手机” to official
file previews. A same-origin, main-frame-only WebMessage bridge accepts bounded chunks and
writes only the URI selected through Android CreateDocument. The URI stays native.
Maximum file size is 16 MiB. Cancellation, Host switching and Activity destruction invalidate
pending exports; cleanup failures report that a partial file may remain. See the
[file contract](../../contracts/file-export.md).
Keep WebView updated for official `dsh-resource:` URL support; the shell does not polyfill
or replace the official resource viewer.

## Build and signing

From `android/`, with JDK 17, SDK 35 and Build Tools 35.0.0:

```sh
./gradlew :b0:testDebugUnitTest :b0:assembleDebug
```

The debug artifact is `b0/build/outputs/apk/debug/b0-debug.apk`. Offline builds require
all Gradle distributions and dependencies already cached. Debug builds are not release packages.

`scripts/prepare-release-candidate.sh` builds an unsigned release plus lint report in a fresh
`JARVIS_B0_CANDIDATE_DIR`. It requires a clean checkout so its source revision identifies the
artifact. It does not sign or install anything. Its behavior tests run with:

```sh
python3 b0/scripts/prepare-release-candidate.test.py
```

`scripts/sign-release.sh` signs an already built release only when the caller sets
`ANDROID_HOME`, `JARVIS_B0_KEYSTORE`, `JARVIS_B0_PASSWORD_FILE`, `JARVIS_B0_KEY_ALIAS`,
`JARVIS_B0_CERT_SHA256` and `JARVIS_B0_RELEASE_DIR`. Keep all private files outside Git.
The script verifies package/version, alignment, v2/v3 signatures and the supplied certificate
fingerprint. It refuses to overwrite an existing candidate. Existing installs require the
same signing key; increase versionCode deliberately before a new release.

## Verification boundaries

Unit tests cover protocol parsing, connection and navigation gates, exports, account flow and
notification decisions. An APK build alone cannot verify rendering, runtime permission UI,
background delivery or file picker integration. Before distribution, test login/password change,
server switching, Back ordering, file save/cancel, notification tap and reconnect on an isolated
Host and real Android device, including narrow layouts and keyboard visibility.
