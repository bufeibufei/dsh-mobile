package com.jarvis.b0

import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId

internal data class ScheduledNotifyAction(val id: String, val label: String)
internal data class ScheduledNotifyItem(val key: String, val at: String, val title: String, val text: String,
    val open: String?, val actions: List<ScheduledNotifyAction>, val snooze: Boolean) {
    val time: Long get() = Instant.parse(at).toEpochMilli()
}
internal data class ScheduledNotifyDaily(val key: String, val time: String, val timezone: String)
internal data class ScheduledNotifySnapshot(val version: String, val items: List<ScheduledNotifyItem>,
    val daily: List<ScheduledNotifyDaily>)
internal data class ScheduledNotifyAlarm(val item: ScheduledNotifyItem, val at: Long, val delivered: Boolean = false)
internal data class ScheduledNotifyFailure(val since: Long? = null, val notified: Boolean = false)
internal data class ScheduledNotifyContent(val key: String, val date: String, val shouldNotify: Boolean,
    val title: String, val text: String, val open: String?)

/** Pure scheduling policy. Delivered keys survive removal from the current snapshot. */
internal object ScheduledNotifyGate {
    const val DAY = 86400000L
    data class Diff(val cancel: List<ScheduledNotifyAlarm>, val schedule: List<ScheduledNotifyAlarm>,
        val retained: List<ScheduledNotifyAlarm>)
    fun changed(oldVersion: String?, nextVersion: String): Boolean = oldVersion != nextVersion
    fun diff(old: List<ScheduledNotifyAlarm>, snapshot: ScheduledNotifySnapshot, now: Long,
        delivered: Set<String> = emptySet()): Diff {
        val wanted = snapshot.items.associateBy { it.key }
        val previous = old.associateBy { it.item.key }
        // Keys are immutable by contract. Preserve local snoozes (including imported ones).
        val retained = old.filter { wanted.containsKey(it.item.key) }.map {
            it.copy(item = wanted.getValue(it.item.key))
        }
        val cancelled = old.filterNot { wanted.containsKey(it.item.key) }
        val added = snapshot.items.filter { !previous.containsKey(it.key) && it.key !in delivered && it.time > now }
            .map { ScheduledNotifyAlarm(it, it.time) }
        return Diff(cancelled, added, retained)
    }
    fun restore(alarms: List<ScheduledNotifyAlarm>, now: Long) = alarms.filter { !it.delivered && it.at > now }
    fun snooze(alarm: ScheduledNotifyAlarm, now: Long) = alarm.copy(at = Math.addExact(now, 600000), delivered = false)
    fun failed(previous: ScheduledNotifyFailure, now: Long) = previous.copy(since = previous.since ?: now)
    fun shouldWarn(failure: ScheduledNotifyFailure, now: Long) =
        failure.since?.let { now >= it && now - it >= DAY && !failure.notified } == true
    fun nextDaily(daily: ScheduledNotifyDaily, now: Long): Long {
        val zone = ZoneId.of(daily.timezone)
        val current = Instant.ofEpochMilli(now).atZone(zone)
        val time = LocalTime.parse(daily.time)
        var next = current.toLocalDate().atTime(time).atZone(zone)
        if (!next.isAfter(current)) next = current.toLocalDate().plusDays(1).atTime(time).atZone(zone)
        return next.toInstant().toEpochMilli()
    }
    fun date(daily: ScheduledNotifyDaily, at: Long): String =
        Instant.ofEpochMilli(at).atZone(ZoneId.of(daily.timezone)).toLocalDate().toString()
    fun dailyToken(key: String, date: String) = "$key@$date"
}
