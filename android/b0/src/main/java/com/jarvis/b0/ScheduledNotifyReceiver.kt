package com.jarvis.b0

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ScheduledNotifyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(ScheduledNotifyScheduler.ACTION_ALARM,
                ScheduledNotifyNotifications.ACTION, ScheduledNotifyNotifications.SNOOZE)) return
        val pending = goAsync()
        ScheduledNotifySync.get(context).receive(intent.getStringExtra("host"), intent.getStringExtra("key"),
            intent.getLongExtra("at", 0), intent.action, intent.getStringExtra("actionId")) { pending.finish() }
    }
}

class ScheduledNotifyBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
                Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED,
                "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED")) return
        if (intent.action in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED))
            SessionNotifyRuntime.get(context).boot()
        val pending = goAsync()
        ScheduledNotifySync.get(context).restore { pending.finish() }
    }
}
