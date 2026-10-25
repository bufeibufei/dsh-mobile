package com.jarvis.b0

import java.net.URI

/** Only absolute HTTP(S) URLs can leave the WebView. Time is monotonic milliseconds. */
internal class ExternalLinkGate {
    sealed class Result {
        object Allow : Result()
        data class Ask(val host: String) : Result()
        object Reject : Result()
    }

    private val recent = mutableMapOf<String, Long>()

    fun check(host: HostAddress?, target: String, nowMillis: Long): Result {
        val uri = runCatching { URI(target).parseServerAuthority() }.getOrNull()
            ?: return Result.Reject
        if ((!uri.scheme.equals("https", true) && !uri.scheme.equals("http", true)) ||
            uri.host.isNullOrEmpty() || uri.rawUserInfo != null || uri.port !in -1..65535)
            return Result.Reject
        // Host navigations (auth redirects, reloads) may repeat quickly and are never deduplicated.
        if (host?.owns(target) == true) return Result.Allow
        recent.entries.removeAll { nowMillis - it.value >= 1_000 || nowMillis < it.value }
        if (recent.containsKey(target)) return Result.Reject
        recent[target] = nowMillis
        return Result.Ask(uri.host)
    }
}
