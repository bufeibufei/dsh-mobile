package com.jarvis.b0

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

internal class ScheduledNotifyNotifications(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)
    init {
        manager.createNotificationChannels(listOf(
            NotificationChannel(ITEMS, "定时提醒", NotificationManager.IMPORTANCE_HIGH),
            NotificationChannel(DAILY, "每日概况", NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(LOGIN, "登录提醒", NotificationManager.IMPORTANCE_DEFAULT)
        ))
    }
    fun allowed(): Boolean = manager.areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context,
            Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    private fun open(host: String, key: String, open: String? = null): PendingIntent =
        PendingIntent.getActivity(context, 0, Intent(context, B0Activity::class.java).apply {
            action = "com.jarvis.b0.OPEN_SCHEDULED_NOTIFY"
            data = ScheduledNotifyScheduler.identity(host, key)
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("scheduleHost", host); putExtra("scheduleKey", key); putExtra("scheduleOpen", open)
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    private fun action(host: String, item: ScheduledNotifyItem, id: String?): PendingIntent =
        PendingIntent.getBroadcast(context, 0, Intent(context, ScheduledNotifyReceiver::class.java).apply {
            action = if (id == null) SNOOZE else ACTION
            data = ScheduledNotifyScheduler.identity(host, item.key).buildUpon().appendQueryParameter("action", id ?: "@snooze").build()
            putExtra("host", host); putExtra("key", item.key); putExtra("actionId", id)
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun item(host: String, alarm: ScheduledNotifyAlarm, failed: Boolean = false): Boolean {
        val item = alarm.item
        val text = if (failed) "操作失败，请重试或打开应用" else item.text
        val builder = NotificationCompat.Builder(context, ITEMS).setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(item.title).setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open(host, item.key, item.open)).setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setOnlyAlertOnce(failed)
        item.actions.take(2).forEach { builder.addAction(0, it.label, action(host, item, it.id)) }
        if (item.snooze) builder.addAction(0, "稍后提醒", action(host, item, null))
        return post(item.key, builder)
    }
    fun daily(host: String, content: ScheduledNotifyContent): Boolean = post(content.key,
        NotificationCompat.Builder(context, DAILY).setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(content.title).setContentText(content.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(content.text))
            .setContentIntent(open(host, content.key, content.open)).setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE))
    fun login(host: String): Boolean = post(LOGIN, NotificationCompat.Builder(context, LOGIN)
        .setSmallIcon(android.R.drawable.ic_popup_reminder).setContentTitle("登录提醒")
        .setContentText("请打开应用重新登录以继续接收提醒")
        .setContentIntent(open(host, LOGIN)).setAutoCancel(true).setOnlyAlertOnce(true))
    @SuppressLint("MissingPermission")
    private fun post(tag: String, builder: NotificationCompat.Builder): Boolean {
        if (!allowed()) return false
        return try { manager.notify(tag, 0, builder.build()); true } catch (_: SecurityException) { false }
    }
    fun cancel(key: String) = manager.cancel(key, 0)
    fun clear() {
        manager.activeNotifications.filter { it.notification.channelId in setOf(ITEMS, DAILY, LOGIN) }
            .forEach { manager.cancel(it.tag, it.id) }
    }
    companion object {
        // Opaque compatibility IDs preserve existing channel preferences.
        const val ITEMS = "life-plans"
        const val DAILY = "life-daily-brief"
        const val LOGIN = "life-login"
        const val ACTION = "com.jarvis.b0.SCHEDULED_NOTIFY_ACTION"
        const val SNOOZE = "com.jarvis.b0.SCHEDULED_NOTIFY_SNOOZE"
    }
}
