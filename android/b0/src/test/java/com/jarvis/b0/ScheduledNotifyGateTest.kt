package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ScheduledNotifyGateTest {
    private val now = Instant.parse("2026-10-26T00:00:00Z").toEpochMilli()
    private fun item(key: String = "demo/a", time: Long = now + 1000) = ScheduledNotifyItem(key,
        Instant.ofEpochMilli(time).toString(), "Example", "", null, emptyList(), true)
    private fun snapshot(vararg items: ScheduledNotifyItem) = ScheduledNotifySnapshot("a".repeat(64), items.toList(), emptyList())
    @Test fun initialOnlySchedulesFuture() {
        val future = item()
        assertEquals(listOf(ScheduledNotifyAlarm(future, future.time)),
            ScheduledNotifyGate.diff(emptyList(), snapshot(future, item("demo/b", now), item("demo/c", now - 1)), now).schedule)
    }
    @Test fun revisionCancelsOldAndAddsNewKey() {
        val old = ScheduledNotifyAlarm(item(), now + 1000)
        val next = item("demo/new", now + 2000)
        val diff = ScheduledNotifyGate.diff(listOf(old), snapshot(next), now)
        assertEquals(listOf(old), diff.cancel); assertEquals(listOf(ScheduledNotifyAlarm(next, next.time)), diff.schedule)
    }
    @Test fun removedItemCancelsSnooze() {
        val old = ScheduledNotifyGate.snooze(ScheduledNotifyAlarm(item(), now, true), now)
        assertEquals(listOf(old), ScheduledNotifyGate.diff(listOf(old), snapshot(), now).cancel)
    }
    @Test fun ordinarySyncRetainsLocalSnoozeAndTombstoneDoesNotSuppressIt() {
        val old = ScheduledNotifyGate.snooze(ScheduledNotifyAlarm(item(time = now - 1), now, true), now)
        val diff = ScheduledNotifyGate.diff(listOf(old), snapshot(old.item), now, setOf(old.item.key))
        assertEquals(listOf(old), diff.retained); assertTrue(diff.schedule.isEmpty()); assertTrue(diff.cancel.isEmpty())
    }
    @Test fun importedSnoozeGetsAuthoritativeContentWithoutMovingTime() {
        val old = ScheduledNotifyGate.snooze(ScheduledNotifyAlarm(item(), now), now)
        val fresh = old.item.copy(open = "opaque:updated")
        assertEquals(old.copy(item = fresh), ScheduledNotifyGate.diff(listOf(old), snapshot(fresh), now).retained.single())
    }
    @Test fun tombstonePreventsReappearingKeyFromRefiring() {
        assertTrue(ScheduledNotifyGate.diff(emptyList(), snapshot(item()), now, setOf("demo/a")).schedule.isEmpty())
    }
    @Test fun clockRollbackDoesNotRestoreDeliveredItem() {
        val old = ScheduledNotifyAlarm(item(), now + 1000, true)
        val retained = ScheduledNotifyGate.diff(listOf(old), snapshot(old.item), now - 10000).retained
        assertTrue(ScheduledNotifyGate.restore(retained, now - 10000).isEmpty())
    }
    @Test fun bootRestoresOnlyFutureUndeliveredAlarms() {
        val future = ScheduledNotifyAlarm(item(), now + 1000)
        assertEquals(listOf(future), ScheduledNotifyGate.restore(listOf(future,
            future.copy(at = now), future.copy(delivered = true)), now))
    }
    @Test fun snoozeIsTenMinutesAndUndelivered() {
        val snooze = ScheduledNotifyGate.snooze(ScheduledNotifyAlarm(item(), now, true), now)
        assertEquals(now + 600000, snooze.at); assertFalse(snooze.delivered)
    }
    @Test fun versionControlsDiff() {
        assertTrue(ScheduledNotifyGate.changed(null, "a")); assertFalse(ScheduledNotifyGate.changed("a", "a"))
        assertTrue(ScheduledNotifyGate.changed("a", "b"))
    }
    @Test fun failureStreakStartsOnceAndWarnsAtOneDay() {
        val failure = ScheduledNotifyGate.failed(ScheduledNotifyFailure(), now)
        assertEquals(failure, ScheduledNotifyGate.failed(failure, now + 1000))
        assertFalse(ScheduledNotifyGate.shouldWarn(failure, now + ScheduledNotifyGate.DAY - 1))
        assertTrue(ScheduledNotifyGate.shouldWarn(failure, now + ScheduledNotifyGate.DAY))
        assertFalse(ScheduledNotifyGate.shouldWarn(failure.copy(notified = true), now + ScheduledNotifyGate.DAY * 2))
        assertFalse(ScheduledNotifyGate.shouldWarn(failure, now - 1))
        assertFalse(ScheduledNotifyGate.shouldWarn(ScheduledNotifyFailure(), now + ScheduledNotifyGate.DAY * 2))
    }
    @Test fun dailyUsesProviderTimezoneAndTomorrowAtBoundary() {
        val daily = ScheduledNotifyDaily("demo/summary", "08:00", "Asia/Shanghai")
        assertEquals(now, ScheduledNotifyGate.nextDaily(daily, now - 1))
        assertEquals(now + ScheduledNotifyGate.DAY, ScheduledNotifyGate.nextDaily(daily, now))
        assertEquals("2026-10-26", ScheduledNotifyGate.date(daily, now))
    }
    @Test fun dailyCalendarCrossesSpringDst() {
        val daily = ScheduledNotifyDaily("demo/summary", "08:00", "America/New_York")
        assertEquals(Instant.parse("2026-03-08T12:00:00Z").toEpochMilli(),
            ScheduledNotifyGate.nextDaily(daily, Instant.parse("2026-03-07T13:00:00Z").toEpochMilli()))
    }
    @Test fun nonexistentDailyTimeMovesForwardAcrossGap() {
        val daily = ScheduledNotifyDaily("demo/summary", "02:30", "America/New_York")
        assertEquals(Instant.parse("2026-03-08T07:30:00Z").toEpochMilli(),
            ScheduledNotifyGate.nextDaily(daily, Instant.parse("2026-03-08T05:00:00Z").toEpochMilli()))
    }
    @Test fun repeatedHourChoosesFirstOccurrenceAndDoesNotFireTwice() {
        val daily = ScheduledNotifyDaily("demo/summary", "01:30", "America/New_York")
        val first = Instant.parse("2026-11-01T05:30:00Z").toEpochMilli()
        assertEquals(first, ScheduledNotifyGate.nextDaily(daily, first - 1))
        assertEquals(Instant.parse("2026-11-02T06:30:00Z").toEpochMilli(), ScheduledNotifyGate.nextDaily(daily, first))
    }
    @Test fun dailyDedupeIncludesKeyAndDate() {
        val first = ScheduledNotifyGate.dailyToken("demo/a", "2026-10-26")
        assertNotEquals(first, ScheduledNotifyGate.dailyToken("demo/b", "2026-10-26"))
        assertNotEquals(first, ScheduledNotifyGate.dailyToken("demo/a", "2026-10-27"))
    }
}
