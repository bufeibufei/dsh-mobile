# Android shell

Standalone Gradle project, module `:b0`. Requires JDK 17 and Android SDK 35.

```sh
./gradlew :b0:testDebugUnitTest :b0:assembleDebug
```

See [shell documentation](b0/README.md) for behavior, signing and verification boundaries.
Application ID remains `com.jarvis.life.b0`; Kotlin namespace remains `com.jarvis.b0`.

The shell includes generic scheduled local notifications via the optional
[scheduled-notify plugin](../plugins/scheduled-notify/README.md). See the
[scheduling section](b0/README.md#scheduled-local-notifications) for permissions,
upgrade migration, provider page hooks and device verification boundaries.
