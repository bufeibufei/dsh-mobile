package com.jarvis.b0

internal enum class NativeSettingsPage { ACCOUNT, SERVERS, CONNECTION }

/** Only fixed, same-origin main-frame navigation events may open Android settings. */
internal object NativeSettingsMessage {
    fun resolve(
        value: String?, sourceOrigin: String, host: HostAddress, selected: HostAddress?,
        topUrl: String?, isString: Boolean, isMainFrame: Boolean,
        generationMatches: Boolean, loginVisible: Boolean, passwordBlocked: Boolean
    ): NativeSettingsPage? {
        if (!isString || !isMainFrame || !generationMatches || loginVisible || passwordBlocked ||
            sourceOrigin.removeSuffix("/") != host.origin || selected?.origin != host.origin ||
            !host.owns(topUrl.orEmpty())) return null
        return when (value) {
            "account" -> NativeSettingsPage.ACCOUNT
            "servers" -> NativeSettingsPage.SERVERS
            "connection" -> NativeSettingsPage.CONNECTION
            else -> null
        }
    }
}
