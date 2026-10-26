package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test

class ScheduledNotifyStoreTest {
    @Test fun roundTripAllDurableStateAndEnabledPreference() {
        var raw: String? = null; var enabled = true
        val store = ScheduledNotifyStore({ raw }, { raw = it; true }, { enabled }, { enabled = it })
        val item = ScheduledNotifyItem("demo/one", "2026-10-26T08:00:00Z", "Example", "", null, emptyList(), true)
        val state = ScheduledNotifyState("https://dsh.example.com", ScheduledNotifySnapshot("a".repeat(64), listOf(item),
            listOf(ScheduledNotifyDaily("demo/summary", "08:00", "UTC"))), listOf(ScheduledNotifyAlarm(item, 123)),
            ScheduledNotifyFailure(100, true), setOf("demo/old"), setOf("demo/summary@2026-10-26"),
            mapOf("demo/summary" to 123L), true, true)
        store.write(state); assertEquals(state, store.read())
        assertEquals(state, ScheduledNotifyStore({ raw }, { true }).read())
        store.setEnabled(false); assertFalse(store.enabled())
    }
    @Test fun absentOrCorruptStoreUsesSafeEmptyState() {
        for (raw in listOf(null, "{", "null", "{\"alarms\":null}"))
            assertEquals(ScheduledNotifyState(), ScheduledNotifyStore({ raw }, { true }).read())
    }
    @Test fun failedCommitIsVisibleAndKeepsPreviousData() {
        var raw: String? = null; var fail = false
        val store = ScheduledNotifyStore({ raw }, { if (fail) false else { raw = it; true } })
        val initial = ScheduledNotifyState(delivered = setOf("demo/one"))
        store.write(initial); fail = true
        assertThrows(IllegalStateException::class.java) { store.write(ScheduledNotifyState()) }
        assertEquals(initial, store.read())
    }
    @Test fun hostResetClearsTombstonesAndPendingDailyTogether() {
        var raw: String? = null
        val store = ScheduledNotifyStore({ raw }, { raw = it; true })
        store.write(ScheduledNotifyState(host = "https://dsh.example.com", delivered = setOf("demo/one"),
            pendingDaily = mapOf("demo/summary" to 123L), legacyImported = true))
        store.write(ScheduledNotifyState(legacyImported = true))
        assertEquals(ScheduledNotifyState(legacyImported = true), store.read())
    }
}
