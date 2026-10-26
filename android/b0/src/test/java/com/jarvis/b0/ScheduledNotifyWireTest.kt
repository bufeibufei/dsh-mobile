package com.jarvis.b0

import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

class ScheduledNotifyWireTest {
    private val raw = """{"ok":true,"value":{"version":"${"a".repeat(64)}","items":[{"key":"demo/one","at":"2026-10-26T08:00:00Z","title":"Example","text":"","open":"opaque:1","actions":[{"id":"done","label":"Done"}],"snooze":true}],"daily":[{"key":"demo/summary","time":"08:00","timezone":"America/New_York"}]}}"""
    private fun rejected(raw: String) { assertThrows(Exception::class.java) { ScheduledNotifyWire.snapshot(raw) } }
    @Test fun parsesGenericSnapshot() {
        val snapshot = ScheduledNotifyWire.snapshot(raw)
        assertEquals("demo/one", snapshot.items.single().key); assertEquals("opaque:1", snapshot.items.single().open)
        assertTrue(snapshot.items.single().snooze); assertEquals("08:00", snapshot.daily.single().time)
    }
    @Test fun nullOpenAndTwoActionsAccepted() {
        val value = raw.replace("\"opaque:1\"", "null").replace("[{\"id\":\"done\",\"label\":\"Done\"}]",
            "[{\"id\":\"done\",\"label\":\"Done\"},{\"id\":\"skip\",\"label\":\"Skip\"}]")
        val item = ScheduledNotifyWire.snapshot(value).items.single(); assertNull(item.open); assertEquals(2, item.actions.size)
    }
    @Test fun strictJsonRejectsTrailingTokensAndDuplicates() {
        for (bad in listOf(raw + "{}", raw.replace("\"ok\":true", "\"ok\":true,\"ok\":true"),
            raw.replace("\"snooze\":true", "\"snooze\":true,\"snooze\":false"), raw.replace("\"ok\"", "ok"))) rejected(bad)
    }
    @Test fun rejectsEnvelopeAndUnknownMembers() {
        for (bad in listOf(raw.replace("\"ok\":true", "\"ok\":false"), raw.replace("\"ok\":true", "\"ok\":\"true\""),
            raw.replace("\"text\":\"\"", "\"extra\":1,\"text\":\"\""), raw.replace("\"text\":\"\",", ""))) rejected(bad)
    }
    @Test fun validatesHashAndPrefixedKeys() {
        for (bad in listOf(raw.replace("a".repeat(64), "v1"), raw.replace("demo/one", "one"), raw.replace("demo/one", "Bad/one"),
            raw.replace("demo/one", "demo/" + "x".repeat(129)), raw.replace("demo/one", "demo/a/b"))) rejected(bad)
    }
    @Test fun validatesDatesTimesAndZones() {
        for (bad in listOf(raw.replace("2026-10-26", "2026-02-30"), raw.replace("08:00\"", "24:00\""),
            raw.replace("America/New_York", "Invalid/Zone"), raw.replace("2026-10-26T08:00:00Z", "now"),
            raw.replace("T08:00:00Z", "T24:00:00Z"), raw.replace("T08:00:00Z", "T23:59:60Z"))) rejected(bad)
    }
    @Test fun enforcesTypesAndOpenLength() {
        for (bad in listOf(raw.replace("\"opaque:1\"", "1"), raw.replace("opaque:1", "x".repeat(257)),
            raw.replace("\"snooze\":true", "\"snooze\":1"), raw.replace("\"text\":\"\"", "\"text\":false"))) rejected(bad)
        assertEquals(256, ScheduledNotifyWire.snapshot(raw.replace("opaque:1", "x".repeat(256))).items.single().open!!.length)
    }
    @Test fun actionLimitsAndDuplicates() {
        for (bad in listOf(raw.replace("\"id\":\"done\"", "\"id\":\"Bad\""), raw.replace("Done", "123456789"),
            raw.replace("[{\"id\":\"done\",\"label\":\"Done\"}]", "[{\"id\":\"a\",\"label\":\"a\"},{\"id\":\"b\",\"label\":\"b\"},{\"id\":\"c\",\"label\":\"c\"}]"),
            raw.replace("[{\"id\":\"done\",\"label\":\"Done\"}]", "[{\"id\":\"a\",\"label\":\"a\"},{\"id\":\"a\",\"label\":\"a\"}]"))) rejected(bad)
    }
    @Test fun duplicateKeysAcrossBothCollectionsRejected() {
        rejected(raw.replace("demo/summary", "demo/one"))
        val json = JsonParser.parseString(raw).asJsonObject
        val items = json.getAsJsonObject("value").getAsJsonArray("items"); items.add(items[0].deepCopy())
        rejected(json.toString())
    }
    @Test fun rejectsOversizedPayload() { rejected(" ".repeat(1024 * 1024) + raw) }
    @Test fun contentChecksRealDateAndTypedPayload() {
        val content = """{"ok":true,"value":{"key":"demo/summary","date":"2026-10-26","shouldNotify":true,"title":"Daily","text":"","open":null}}"""
        assertEquals("2026-10-26", ScheduledNotifyWire.content(content).date)
        assertThrows(Exception::class.java) { ScheduledNotifyWire.content(content.replace("2026-10-26", "2026-02-30")) }
        assertThrows(Exception::class.java) { ScheduledNotifyWire.content(content.replace("\"shouldNotify\":true", "\"shouldNotify\":1")) }
    }
    @Test fun actionResponseMustEchoKeyActionAndDone() {
        val response = """{"ok":true,"value":{"key":"demo/one","action":"done","status":"done"}}"""
        ScheduledNotifyWire.action(response, "demo/one", "done")
        assertThrows(Exception::class.java) { ScheduledNotifyWire.action(response, "demo/another", "done") }
        assertThrows(Exception::class.java) { ScheduledNotifyWire.action(response, "demo/one", "skip") }
        assertThrows(Exception::class.java) { ScheduledNotifyWire.action(response.replace("\"status\":\"done\"", "\"status\":\"pending\""), "demo/one", "done") }
    }
}
