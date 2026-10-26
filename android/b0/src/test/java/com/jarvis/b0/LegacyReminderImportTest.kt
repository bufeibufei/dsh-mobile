package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class LegacyReminderImportTest {
    private val now = Instant.parse("2026-10-26T08:00:00Z").toEpochMilli()
    // Fixture uses the persisted pre-upgrade state shape, including ignored business fields.
    private fun fixture(host: String = "https://dsh.example.com") = """{
      "host":"$host","snapshot":{"version":"old","timezone":"UTC","settings":{"enabled":true,"dailyBriefEnabled":true,"dailyBriefTime":"08:00"},"reminders":[]},
      "alarms":[
        {"reminder":{"key":"delivered:1","planId":"id-1","shortId":"P1","title":"Example","plannedDate":"2026-10-26","plannedTime":"07:00","place":null,"remindAt":"2026-10-26T07:00:00Z"},"at":${now - 3600000},"delivered":true},
        {"reminder":{"key":"snoozed:2","planId":"id-2","shortId":"P2","title":"Example two","plannedDate":"2026-10-26","plannedTime":"08:00","place":"Example room","remindAt":"2026-10-26T08:00:00Z"},"at":${now + 600000},"delivered":false},
        {"reminder":{"key":"future:3","planId":"id-3","shortId":"P3","title":"Future","plannedDate":"2026-10-26","plannedTime":null,"place":null,"remindAt":"2026-10-26T09:00:00Z"},"at":${now + 3600000},"delivered":false}
      ],"failure":{"since":null,"notified":false},"lastBriefDate":"2026-10-26","needsRestore":false
    }"""
    @Test fun importsDeliveredSnoozeAndDailyDate() {
        val result = LegacyReminderImport.decode(fixture(), ScheduledNotifyState(), now)
        assertEquals(setOf("life/delivered:1", "life/snoozed:2"), result.state.delivered)
        assertEquals(setOf("life/brief@2026-10-26"), result.state.dailyDelivered)
        val alarm = result.state.alarms.single()
        assertEquals("life/snoozed:2", alarm.item.key); assertEquals(now + 600000, alarm.at); assertFalse(alarm.delivered)
        assertEquals("plan:id-2", alarm.item.open); assertEquals("08:00 · Example room", alarm.item.text)
        assertTrue(result.state.legacyImported)
        assertEquals(listOf("delivered:1", "snoozed:2", "future:3"), result.alarmKeys)
    }
    @Test fun importerIsOneTimeButRetainsCancellationKeysUntilCleanup() {
        val first = LegacyReminderImport.decode(fixture(), ScheduledNotifyState(), now)
        val second = LegacyReminderImport.decode(fixture(), first.state, now)
        assertEquals(first, second)
    }
    @Test fun doesNotImportOldHostDataIntoAnotherHost() {
        val current = ScheduledNotifyState(host = "https://other.example.com", delivered = setOf("demo/a"))
        val imported = LegacyReminderImport.decode(fixture(), current, now)
        assertEquals(current.copy(legacyImported = true), imported.state); assertEquals(3, imported.alarmKeys.size)
    }
    @Test fun expiredSnoozesAreNotRestored() {
        val imported = LegacyReminderImport.decode(fixture(), ScheduledNotifyState(), now + 600001)
        assertTrue(imported.state.alarms.isEmpty())
    }
    @Test fun missingOrCorruptLegacyStoreCannotCrashStartup() {
        for (raw in listOf(null, "{", "null", "{\"alarms\":null}")) {
            val result = LegacyReminderImport.decode(raw, ScheduledNotifyState(), now)
            assertTrue(result.state.legacyImported); assertTrue(result.state.alarms.isEmpty())
        }
    }
    @Test fun migratedTombstonesSurviveNewProviderSnapshot() {
        val state = LegacyReminderImport.decode(fixture(), ScheduledNotifyState(), now).state
        val item = ScheduledNotifyItem("life/delivered:1", "2026-10-26T09:00:00Z", "Example", "", null, emptyList(), false)
        assertTrue(ScheduledNotifyGate.diff(emptyList(), ScheduledNotifySnapshot("a".repeat(64), listOf(item), emptyList()),
            now, state.delivered).schedule.isEmpty())
    }
}
