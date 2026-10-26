package com.jarvis.b0

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

internal class ScheduledNotifyScheduler(private val context: Context) {
    private val manager = context.getSystemService(AlarmManager::class.java)
    fun exactAllowed(): Boolean = Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms()

    private fun pending(host: String, key: String, at: Long = 0): PendingIntent =
        PendingIntent.getBroadcast(context, 0, Intent(context, ScheduledNotifyReceiver::class.java).apply {
            action = ACTION_ALARM
            data = identity(host, key)
            putExtra("host", host); putExtra("key", key); putExtra("at", at)
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun cancel(host: String, key: String) { manager.cancel(pending(host, key)) }
    // exactAllowed checks canScheduleExactAlarms; revocation between check and set is caught below.
    @SuppressLint("ScheduleExactAlarm")
    fun schedule(host: String, key: String, at: Long) {
        val operation = pending(host, key, at)
        if (exactAllowed()) {
            try {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, operation)
                return
            } catch (_: SecurityException) { /* Permission can be revoked between check and use. */ }
        }
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, operation)
    }
    fun daily(state: ScheduledNotifyState, now: Long) {
        val host = state.host ?: return
        state.snapshot?.daily?.forEach { schedule(host, it.key, ScheduledNotifyGate.nextDaily(it, now)) }
    }
    fun restore(state: ScheduledNotifyState, now: Long) {
        val host = state.host ?: return
        ScheduledNotifyGate.restore(state.alarms, now).forEach { schedule(host, it.item.key, it.at) }
        daily(state, now)
    }
    fun clear(state: ScheduledNotifyState) {
        val host = state.host ?: return
        state.alarms.forEach { cancel(host, it.item.key) }
        state.snapshot?.daily?.forEach { cancel(host, it.key) }
    }
    companion object {
        const val ACTION_ALARM = "com.jarvis.b0.SCHEDULED_NOTIFY_ALARM"
        fun identity(host: String, key: String): Uri = Uri.Builder().scheme("dsh-mobile-schedule")
            .authority("local").appendPath(host).appendPath(key).build()
    }
}
