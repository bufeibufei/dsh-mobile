package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test
import java.io.StringReader

class SessionNotifyWireTest {
    private val json = """{"id":128,"at":"2026-10-25T09:00:00Z","sessionId":"fictional",
        "sessionTitle":null,"kind":"reply","preview":"虚构预览","automated":false,"viewing":true}"""
    private fun frame(data: String = json, id: String = "128") = SessionSseFrame(id, "notify", data)
    private fun parse(raw: String): List<SessionSseFrame> = mutableListOf<SessionSseFrame>().also { frames ->
        SessionNotifySse.read(StringReader(raw), consume = frames::add)
    }
    @Test fun heartbeatHasNoEventAndMultilineFramesAcceptAllLineEndings() {
        for (end in listOf("\n", "\r\n", "\r")) {
            var heartbeats = 0
            val frames = mutableListOf<SessionSseFrame>()
            val raw = listOf("\uFEFF: ping", "", "id: 128", "event: notify", "data: first", "data: second", "", "").joinToString(end)
            SessionNotifySse.read(StringReader(raw), heartbeat = { heartbeats++ }, consume = frames::add)
            assertEquals(1, heartbeats)
            assertEquals(listOf(SessionSseFrame("128", "notify", "first\nsecond")), frames)
        }
    }
    @Test fun truncatedFrameIsNotAcknowledgedAndFieldsDoNotLeak() {
        assertTrue(parse("id: 3\nevent: notify\ndata: incomplete").isEmpty())
        assertEquals(listOf(SessionSseFrame("1", "notify", "one"), SessionSseFrame(null, "message", "two")),
            parse("id:1\nevent:notify\ndata:one\n\ndata:two\n\n"))
    }
    @Test fun resetAndEmptyDataFramesParseButUnknownFieldsAreIgnored() {
        val frames = parse("retry: 999\nevent: reset\ndata: {\"epoch\":\"new\",\"last\":128}\n\ndata:\n\n")
        assertEquals(SessionNotifyReset("new", 128), SessionNotifyWire.reset(frames[0]))
        assertEquals("", frames[1].data)
    }
    @Test fun nullInIdIsIgnored() {
        assertNull(parse("id: 1\u0000\ndata: x\n\n").single().id)
    }
    @Test fun oversizedLinesAndFramesFailWithoutDelivery() {
        assertTrue(runCatching { parse("data:" + "x".repeat(65536)) }.isFailure)
        assertTrue(runCatching { parse(("data:" + "x".repeat(40000) + "\n").repeat(2)) }.isFailure)
    }
    @Test fun cancellationStopsBeforeReadingNextFrame() {
        var active = true
        var count = 0
        SessionNotifySse.read(StringReader("data: one\n\ndata: two\n\n"), { active }) {
            count++; active = false
        }
        assertEquals(1, count)
    }
    @Test fun contractNoticeParsesAndServerViewingDoesNotSuppress() {
        val notice = SessionNotifyWire.notice(frame())
        assertNull(notice.sessionTitle)
        assertEquals(128L, notice.id)
        assertNotNull(SessionNotifyGate.decide(notice, SessionNotifySettings(), false, null))
    }
    @Test fun malformedIdsKindsTypesOrDatesAreRejected() {
        for (bad in listOf(json.replace("128", "0"), json.replace("128", "1.5"),
                json.replace("128", "\"128\""), json.replace("reply", "aborted"),
                json.replace("false", "\"false\""), json.replace("2026-10-25T09:00:00Z", "tomorrow"),
                json.replace("null", "12"), json.replace("fictional", ""), "<html>login</html>"))
            assertTrue(runCatching { SessionNotifyWire.notice(frame(bad)) }.isFailure)
        assertTrue(runCatching { SessionNotifyWire.notice(frame(id = "129")) }.isFailure)
    }
    @Test fun previewTruncationPreservesUnicodeCodePoints() {
        val notice = SessionNotifyWire.notice(frame(json.replace("虚构预览", "😀".repeat(70))))
        assertEquals("😀".repeat(60), notice.preview)
    }
    @Test fun settingsRequireCompleteBooleanEnvelope() {
        val raw = """{"ok":true,"value":{"enabled":false,"notifyReplies":true,"lockScreenContent":false}}"""
        assertEquals(SessionNotifySettings(false, true, false), SessionNotifyWire.settings(raw))
        for (bad in listOf(raw.replace("false", "\"false\""), raw.replace("\"enabled\":false,", ""),
                raw.replace("\"ok\":true", "\"ok\":false"), "{}"))
            assertTrue(runCatching { SessionNotifyWire.settings(bad) }.isFailure)
    }
    @Test fun resetRequiresNonemptyStringEpochAndNonnegativeIntegerLast() {
        for (data in listOf("{}", """{"epoch":1,"last":0}""", """{"epoch":"","last":0}""",
                """{"epoch":" ","last":0}""", """{"epoch":"new"}""",
                """{"epoch":"new","last":-1}""", """{"epoch":"new","last":1.5}""",
                """{"epoch":"new","last":"1"}""", """{"epoch":"new","last":null}"""))
            assertTrue(runCatching { SessionNotifyWire.reset(SessionSseFrame(null, "reset", data)) }.isFailure)
        val valid = """{"epoch":"new","last":0}"""
        assertEquals(SessionNotifyReset("new", 0), SessionNotifyWire.reset(SessionSseFrame(null, "reset", valid)))
        assertTrue(runCatching { SessionNotifyWire.reset(SessionSseFrame(null, "notify", valid)) }.isFailure)
    }
    @Test fun streamUrlOnlyIncludesCursorWhenBothValuesExist() {
        val origin = "https://fictional.example:8443"
        val base = "$origin/api/session-notify/stream"
        for (cursor in listOf(SessionCursor(), SessionCursor(after = 128), SessionCursor(epoch = "process-1")))
            assertEquals(base, SessionNotifyWire.streamUrl(origin, cursor))
        assertEquals("$base?after=128&epoch=process-1",
            SessionNotifyWire.streamUrl(origin, SessionCursor(128, "process-1")))
        assertEquals("$base?after=0&epoch=process-2",
            SessionNotifyWire.streamUrl(origin, SessionCursor(0, "process-2")))
    }
    @Test fun streamUrlEncodesEpochAsSingleQueryValue() {
        assertEquals("https://fictional.example/api/session-notify/stream?after=7&epoch=a%2Bb%26c%3Dd%2F%3F%23+%E4%B8%AD",
            SessionNotifyWire.streamUrl("https://fictional.example", SessionCursor(7, "a+b&c=d/?# 中")))
    }
}
