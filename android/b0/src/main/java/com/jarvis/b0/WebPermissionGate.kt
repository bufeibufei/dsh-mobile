package com.jarvis.b0

/** UI-thread state machine. A cancelled system dialog must drain before another request. */
internal class WebPermissionGate {
    enum class Kind { AUDIO, LOCATION }
    data class Permissions(val audio: Boolean = false, val coarse: Boolean = false, val fine: Boolean = false) {
        fun allows(kind: Kind): Boolean = when (kind) {
            Kind.AUDIO -> audio
            Kind.LOCATION -> coarse || fine
        }
    }
    data class Result(val allow: Boolean, val retain: Boolean = false)
    private data class Pending(
        val token: Long, val identity: Any, val kind: Kind,
        val valid: () -> Boolean, val reply: (Result) -> Unit
    )
    private var serial = 0L
    private var pending: Pending? = null
    private var systemToken: Long? = null

    /** Returns a token only when the caller must launch an Android permission dialog. */
    fun request(identity: Any, kind: Kind, resources: Set<String>, permissions: Permissions,
        valid: () -> Boolean, reply: (Result) -> Unit): Long? {
        if (!valid() || !allowedResources(kind, resources) || pending != null || systemToken != null) {
            reply(Result(false))
            return null
        }
        if (permissions.allows(kind)) {
            reply(Result(true))
            return null
        }
        val token = ++serial
        pending = Pending(token, identity, kind, valid, reply)
        systemToken = token
        return token
    }

    /** Returns the denied kind only for a still-current request, for user-facing feedback. */
    fun complete(token: Long, permissions: Permissions): Kind? {
        if (systemToken != token) return null
        systemToken = null
        val request = pending?.takeIf { it.token == token } ?: return null
        pending = null
        val current = request.valid()
        val allowed = permissions.allows(request.kind)
        request.reply(Result(current && allowed))
        return request.kind.takeIf { current && !allowed }
    }

    fun cancel(identity: Any? = null, kind: Kind? = null) {
        val request = pending ?: return
        if (identity != null && request.identity !== identity || kind != null && request.kind != kind) return
        pending = null
        request.reply(Result(false))
        // Do not recycle the outstanding system callback into a newer page's request.
    }

    companion object {
        const val AUDIO_CAPTURE = "android.webkit.resource.AUDIO_CAPTURE"

        fun trusted(host: HostAddress?, origin: String, pageUrl: String?,
            currentBrowser: Boolean, foreground: Boolean): Boolean =
            currentBrowser && foreground && host?.owns(origin) == true && host.owns(pageUrl.orEmpty())

        fun allowedResources(kind: Kind, resources: Set<String>): Boolean = when (kind) {
            Kind.AUDIO -> resources == setOf(AUDIO_CAPTURE)
            Kind.LOCATION -> resources.isEmpty()
        }
    }
}
