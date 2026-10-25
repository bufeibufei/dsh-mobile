package com.jarvis.b0

import com.google.gson.JsonObject
import java.io.Reader
import java.net.URLEncoder
import java.time.Instant

internal data class SessionSseFrame(val id: String?, val event: String, val data: String)
internal data class SessionNotifyReset(val epoch: String, val last: Long)

/** Streaming SSE framing, including CRLF, multiline data and comment heartbeats. */
internal object SessionNotifySse {
    private const val LIMIT = 64 * 1024
    fun read(reader: Reader, alive: () -> Boolean = { true }, heartbeat: () -> Unit = {},
        consume: (SessionSseFrame) -> Unit) {
        var id: String? = null
        var event = "message"
        val data = StringBuilder()
        val line = StringBuilder()
        var hadData = false
        var first = true
        var cr = false
        fun acceptLine() {
            val value = line.toString(); line.setLength(0)
            if (value.isEmpty()) {
                if (hadData) consume(SessionSseFrame(id, event, data.toString().removeSuffix("\n")))
                id = null; event = "message"; data.setLength(0); hadData = false
            } else if (value.startsWith(":")) heartbeat()
            else {
                val field = value.substringBefore(':')
                val content = if (':' in value) value.substringAfter(':').removePrefix(" ") else ""
                when (field) {
                    "id" -> if ('\u0000' !in content) id = content
                    "event" -> event = content
                    "data" -> {
                        require(data.length + content.length < LIMIT) { "SSE frame too large" }
                        data.append(content).append('\n'); hadData = true
                    }
                }
            }
        }
        while (alive()) {
            val next = reader.read()
            if (next < 0) return // Incomplete frames are never acknowledged.
            val char = next.toChar()
            if (first) { first = false; if (char == '\uFEFF') continue }
            if (char == '\n' && cr) { cr = false; continue }
            cr = char == '\r'
            if (char == '\r' || char == '\n') acceptLine()
            else { require(line.length < LIMIT) { "SSE line too large" }; line.append(char) }
        }
    }
}

internal object SessionNotifyWire {
    private fun value(raw: String): JsonObject {
        val envelope = requireNotNull(StrictExportJson.parse(raw))
        require(bool(envelope, "ok"))
        return requireNotNull(envelope.getAsJsonObject("value"))
    }
    private fun bool(value: JsonObject, key: String): Boolean {
        val item = requireNotNull(value.get(key))
        require(item.isJsonPrimitive && item.asJsonPrimitive.isBoolean)
        return item.asBoolean
    }

    fun streamUrl(origin: String, cursor: SessionCursor): String {
        val base = "$origin/api/session-notify/stream"
        val after = cursor.after ?: return base
        val epoch = cursor.epoch ?: return base
        return "$base?after=$after&epoch=${URLEncoder.encode(epoch, "UTF-8")}"
    }
    fun settings(raw: String): SessionNotifySettings {
        val value = value(raw)
        return SessionNotifySettings(bool(value, "enabled"),
            bool(value, "notifyReplies"), bool(value, "lockScreenContent"))
    }
    fun reset(frame: SessionSseFrame): SessionNotifyReset {
        require(frame.event == "reset")
        val value = requireNotNull(StrictExportJson.parse(frame.data))
        val epoch = requireNotNull(StrictExportJson.string(value, "epoch"))
            .also { require(it.isNotBlank()) }
        val last = requireNotNull(StrictExportJson.integer(value, "last"))
            .also { require(it >= 0) }
        return SessionNotifyReset(epoch, last)
    }
    fun notice(frame: SessionSseFrame): SessionNotice {
        require(frame.event == "notify")
        val value = requireNotNull(StrictExportJson.parse(frame.data))
        val id = requireNotNull(StrictExportJson.integer(value, "id"))
        require(id > 0 && frame.id == id.toString())
        fun string(key: String) = requireNotNull(StrictExportJson.string(value, key))
        val session = string("sessionId").also { require(it.isNotBlank()) }
        val title = requireNotNull(value.get("sessionTitle"))
        val kind = string("kind").also { require(it in setOf("reply", "failed", "approval", "question")) }
        Instant.parse(string("at"))
        bool(value, "viewing") // Validated but intentionally not used for suppression.
        val preview = string("preview").let { it.take(it.offsetByCodePoints(0, minOf(60, it.codePointCount(0, it.length)))) }
        return SessionNotice(id, session, if (title.isJsonNull) null else string("sessionTitle"),
            kind, preview, bool(value, "automated"))
    }
}
