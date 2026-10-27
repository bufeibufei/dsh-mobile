# Android DSH shell

Android WebView shell for official `@deepseek-ai/dsh@0.2.1-alpha.2`. Module `:b0`,
applicationId `com.jarvis.life.b0`, Kotlin namespace `com.jarvis.b0`. These identities
are retained for install compatibility. The current package is versionCode **13**,
versionName `0.11.0-b0-images`.

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
External HTTP(S) links display their destination hostname for confirmation before opening
in a system browser; unsupported schemes are rejected. Renderer crashes invalidate stale
callbacks and rebuild the WebView before reloading the Host. The third crash within a rolling
minute stops automatic reloads until an explicit retry. Native login/settings forms remain
intact during recovery, and login POSTs are never automatically replayed. Web page drafts
after a renderer crash still require device verification.
Microphone and location access require foreground, same-origin permission checks.

Touch actions, text selection and web Back ordering come from the mobile-ui Host plugin;
updating the APK alone does not update those assets.

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
Android battery policy, force-stop and notification settings can interrupt delivery; actual
device/background behavior must be checked separately from unit tests.

## Scheduled local notifications

The optional [scheduled-notify plugin](../../plugins/scheduled-notify/README.md) aggregates generic
provider entries under the [schedule contract](../../contracts/scheduled-notify.md). The shell syncs
`[now - 1 day, now + 7 days]` on page load, page change messages, foreground activation and an hourly
network job. Boot, package replacement, clock/timezone changes and exact-alarm permission changes
restore pending local alarms and request a sync. Unchanged versions avoid rebuilding the schedule;
delivered keys remain tombstones across versions. Logout or Host switching clears alarms, jobs,
notifications, daily deduplication and cached content, and invalidates outstanding HTTP results.

Item alarms work offline using cached content. Up to two provider actions POST to `/api/mobile-schedule/action`;
failure re-shows the notification with retry text. When `snooze` is true, “稍后提醒” postpones locally by
10 minutes. Daily entries fetch `/api/mobile-schedule/content` at fire time, with a date in the entry's
timezone and `key + date` deduplication. A response for another date/key is discarded. Daily content
needs a network connection; pending daily work is durable and expires at that provider's next date.
Continuous schedule sync failure for a day produces a login warning.

Channels retain opaque IDs `life-plans`, `life-daily-brief`, `life-login`, with neutral names
“定时提醒”, “每日概况”, “登录提醒”. Notification and exact-alarm guidance share the existing session
permission controller and preference keys. Denied exact-alarm access falls back to inexact alarms;
background code never launches permission UI. Manifest permissions include SCHEDULE_EXACT_ALARM and
RECEIVE_BOOT_COMPLETED. Device battery policy and force-stop still affect delivery.

The same-origin main-frame `DshMobileSchedule` WebMessage channel injects
`window.DshMobile.scheduleChanged()`. Notification taps wait for login/page readiness and call
`window.__DSH_MOBILE_OPEN__?.[id]?.(open) === true`, retrying every 250 ms for about 30 seconds.
A null `open` only opens the App. No provider-specific payload is parsed by the shell.

A one-time isolated upgrade importer reads the old preference store, preserves delivered keys,
pending snoozes and the last daily delivery date, then deletes that store and cancels known legacy
jobs and matching alarm PendingIntents. Existing application/package identities and channel settings
remain compatible. Permission preferences are preserved. Notification settings belong to providers;
the shell adds no schedule settings page.

JVM suites cover strict Wire parsing and limits, Gate diff/snooze/failure/timezone/DST behavior,
Store serialization and failed writes, and legacy fixture import. These do not validate platform alarm
or notification delivery; check upgrade, boot, denied permissions, Host switching and action retries
on a device before distribution.

## Images

Web file inputs accepting images (or any file) open the native “添加图片或文件” list:
“拍照”, “从相册选择”, “选择文件”, and “取消”. Camera is hidden when no camera app
resolves the capture intent. Back and outside taps cancel without forwarding Back to the page.
Non-image-only inputs go directly to the unchanged system file chooser; “选择文件”
always returns its original result without preparation.

Gallery uses the image-only Photo Picker when available, otherwise `ACTION_GET_CONTENT`.
Single inputs select one image; multiple inputs accept at most nine, including on fallback
pickers that ignore limits (only the first nine distinct URIs are used). The system camera
writes to a cache-only FileProvider URI. There is no CAMERA or storage permission: capture
is delegated to a camera app with a temporary URI grant, not an in-app camera.

Gallery/camera images are prepared on a worker thread: sampled decode, at most 2048×2048
**total pixels** without upscaling, 8-bit sRGB, JPEG quality 85, with pixel-only output and
no source metadata. PNG is preserved only for PNG sources with actual transparent pixels;
GIF keeps its original URI and animation. API 28+ ImageDecoder applies EXIF orientation.
**API 26–27 uses BitmapFactory and skips EXIF rotation**, so orientation-tagged photos may
appear sideways on these versions. HEIC support depends on the device codec; unreadable
images are skipped with “有 N 张图片无法读取，已跳过”. No surviving images means cancel.
Preparation lasting over 300 ms shows “正在处理图片…” until completion or cancellation.

Outputs use `IMG_<yyyyMMdd_HHmmss>_<n>.jpg` (or `.png`) with processing time, under
`cacheDir/b0-images/`, exposed only through `${applicationId}.images`. Startup and sheet
opening remove files older than 24 hours. Returned files are retained until expiry because
WebView may read them only when sending. Host switching, full page navigation, replacement
of the browser/request, logout and destruction invalidate pending work. An already open
system picker must return before another external picker can launch; its result cannot
satisfy a newer callback. Process death while the camera/picker is open loses the WebView
callback: returning is harmless, but the user must select again; no cross-process restoration.

JVM tests cover chooser options, area limits, formats, expiry and skip notices. Camera URI
grants, Photo Picker/OEM fallback, HEIC/color/orientation/alpha codecs, process death and
actual attachment upload require separate device/Host checks, especially API 26–27 versus 28+.

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
