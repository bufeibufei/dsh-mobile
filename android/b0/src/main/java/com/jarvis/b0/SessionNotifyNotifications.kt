package com.jarvis.b0

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

internal class SessionNotifyNotifications(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)
    init {
        manager.createNotificationChannels(listOf(
            NotificationChannel(SessionNotifyGate.ATTENTION, "需要你确认", NotificationManager.IMPORTANCE_HIGH),
            NotificationChannel(SessionNotifyGate.MESSAGES, "对话消息", NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(KEEP, "保持连接", NotificationManager.IMPORTANCE_MIN).apply {
                setSound(null, null); enableVibration(false); setShowBadge(false)
            }
        ))
    }
    private fun open(host: String? = null, session: String? = null): PendingIntent =
        PendingIntent.getActivity(context, 0, Intent(context, B0Activity::class.java).apply {
            action = "com.jarvis.b0.OPEN_SESSION_NOTIFICATION"
            data = Uri.Builder().scheme("jarvis-session").authority("open")
                .appendQueryParameter("host", host.orEmpty()).appendQueryParameter("session", session.orEmpty()).build()
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (session != null) { putExtra("sessionNotifyHost", host); putExtra("sessionNotifySession", session) }
        }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun keepAlive(): Notification = NotificationCompat.Builder(context, KEEP)
        .setSmallIcon(android.R.drawable.ic_popup_sync).setContentTitle("Jarvis 保持连接")
        .setContentIntent(open()).setOngoing(true).setSilent(true)
        .setPriority(NotificationCompat.PRIORITY_MIN).setCategory(NotificationCompat.CATEGORY_SERVICE).build()

    fun message(host: String, message: SessionNotifyMerge.Message, session: String, decision: SessionNotifyDecision) {
        val builder = NotificationCompat.Builder(context, decision.channel)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(message.title).setContentText(message.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message.text))
            .setContentIntent(open(host, session)).setAutoCancel(true)
            .setSilent(decision.silent).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPriority(if (decision.channel == SessionNotifyGate.ATTENTION) NotificationCompat.PRIORITY_HIGH
                else NotificationCompat.PRIORITY_DEFAULT)
        if (decision.publicVersion) builder.setPublicVersion(
            NotificationCompat.Builder(context, decision.channel)
                .setSmallIcon(android.R.drawable.ic_dialog_email).setContentTitle("Jarvis")
                .setContentText("有新回复").setContentIntent(open(host, session)).setAutoCancel(true).build())
        post(message.tag, message.id, builder.build())
    }
    fun login(host: String?) = status(host, "请打开 Jarvis 重新登录以接收会话通知")
    fun resume(host: String?) = status(host, "请打开 Jarvis 恢复会话通知连接")
    private fun status(host: String?, text: String) = post(STATUS, 1,
        NotificationCompat.Builder(context, SessionNotifyGate.MESSAGES)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Jarvis")
            .setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open(host)).setAutoCancel(true).setOnlyAlertOnce(true).build())

    @SuppressLint("MissingPermission") // Explicit runtime check plus concurrent-revocation handling.
    private fun post(tag: String, id: Int, notice: Notification) {
        if (!manager.areNotificationsEnabled() || Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        try { manager.notify(tag, id, notice) } catch (_: SecurityException) { /* User revoked permission. */ }
    }
    fun cancel(session: String) = manager.cancel(SessionNotifyMerge.tag(session), 1)
    fun cancelStatus() = manager.cancel(STATUS, 1)
    fun clearMessages() {
        manager.activeNotifications.filter { it.tag?.startsWith("session-notify:") == true }
            .forEach { manager.cancel(it.tag, it.id) }
    }
    companion object {
        const val KEEP_ID = 4201
        private const val KEEP = "session-connection"
        private const val STATUS = "session-notify-status"
    }
}
