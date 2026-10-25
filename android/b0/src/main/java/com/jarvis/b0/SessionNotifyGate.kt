package com.jarvis.b0

internal data class SessionNotifySettings(
    val enabled: Boolean = true, val notifyReplies: Boolean = true, val lockScreenContent: Boolean = true
)
internal data class SessionNotice(
    val id: Long, val sessionId: String, val sessionTitle: String?, val kind: String,
    val preview: String, val automated: Boolean
)
internal data class SessionCursor(val after: Long? = null, val epoch: String? = null) {
    fun reset(reset: SessionNotifyReset) = SessionCursor(
        after = when {
            epoch == reset.epoch -> after ?: reset.last
            after != null -> 0L
            else -> reset.last
        },
        epoch = reset.epoch
    )
    fun accepts(id: Long): Boolean = id > 0 && (after == null || id > after)
}
internal data class SessionNotifyState(
    val host: String? = null, val authenticated: Boolean = false,
    val settings: SessionNotifySettings = SessionNotifySettings(),
    val cursor: SessionCursor = SessionCursor(), val loginWarned: Boolean = false
) {
    fun unauthorized() = copy(authenticated = false, loginWarned = true)
    fun admitted(address: String) = (if (host == address) this else SessionNotifyState())
        .copy(host = address, authenticated = true, loginWarned = false)
}
internal data class SessionNotifyDecision(val channel: String, val silent: Boolean, val publicVersion: Boolean)

/** Contract section 6, independent of Android lifecycle and notification APIs. */
internal object SessionNotifyGate {
    const val ATTENTION = "session-attention"
    const val MESSAGES = "session-messages"
    fun decide(event: SessionNotice, settings: SessionNotifySettings, foreground: Boolean,
        viewingSession: String?): SessionNotifyDecision? {
        if (!settings.enabled || foreground && viewingSession == event.sessionId) return null
        if (event.kind == "reply" && !settings.notifyReplies) return null
        val channel = when (event.kind) {
            "approval", "question" -> ATTENTION
            "reply", "failed" -> MESSAGES
            else -> return null
        }
        return SessionNotifyDecision(channel, foreground && channel == MESSAGES, !settings.lockScreenContent)
    }
    fun warnUnauthorized(alreadyWarned: Boolean): Boolean = !alreadyWarned
    fun canBootStart(state: SessionNotifyState, selected: Boolean): Boolean =
        state.authenticated && state.settings.enabled && selected
}

internal class SessionNotifyBackoff {
    private var attempt = 0
    fun nextMillis(): Long = longArrayOf(1, 2, 5, 10, 30, 60)[attempt.coerceAtMost(5)]
        .also { if (attempt < 5) attempt++ } * 1000
    fun reset() { attempt = 0 }
}

/** Fixed (tag, id) avoids hash collisions, including with foreground notifications. */
internal class SessionNotifyMerge {
    data class Message(val tag: String, val id: Int, val title: String, val text: String, val count: Int)
    private data class Window(val started: Long, val count: Int)
    private val windows = mutableMapOf<String, Window>()
    fun clear(session: String) { windows.remove(session) }
    fun clear() = windows.clear()
    fun message(event: SessionNotice, now: Long): Message {
        windows.entries.removeAll { now - it.value.started !in 0 until 10_000 }
        val previous = windows[event.sessionId]
        val count = if (event.kind == "reply") (previous?.count ?: 0) + 1 else 1
        if (event.kind == "reply") windows[event.sessionId] = Window(previous?.started ?: now, count)
        else windows.remove(event.sessionId)
        val title = when (event.kind) {
            "approval" -> "需要你确认"
            "question" -> "Jarvis 在问你"
            else -> (if (event.automated) "自动任务 · " else "") + (event.sessionTitle ?: "Jarvis")
        }
        val text = if (event.kind == "failed") "回复失败，点开查看" else event.preview
        return Message(tag(event.sessionId), 1, title,
            text + if (count > 1) "（${count} 条新消息）" else "", count)
    }
    companion object { fun tag(session: String) = "session-notify:$session" }
}
