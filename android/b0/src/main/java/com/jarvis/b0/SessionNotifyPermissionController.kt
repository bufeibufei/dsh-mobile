package com.jarvis.b0

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.Lifecycle

/** Only foreground guidance; background sync never launches an Activity or a permission prompt. */
internal class SessionNotifyPermissionController(private val activity: ComponentActivity, private val valid: () -> Boolean) {
    private val prefs by lazy { activity.getSharedPreferences("b0-reminder-permissions", 0) }
    private var pending = false
    private var notificationPending = false
    private var pendingExact = false
    private var pendingNeedsExact = false
    private var notificationNeedsExact = false
    private var pendingSession = false
    private var generation = 0L
    private var requestGeneration = 0L
    private var dialog: AlertDialog? = null
    private val request = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        notificationPending = false
        if (requestGeneration == generation) {
            pendingExact = notificationNeedsExact
            resume()
        }
    }
    fun considerSchedule(snapshot: ScheduledNotifySnapshot?, explicit: Boolean = false) {
        if (snapshot == null) return
        val enabledNow = snapshot.items.isNotEmpty() && !prefs.getBoolean("enabled", false) ||
            snapshot.daily.isNotEmpty() && !prefs.getBoolean("briefEnabled", false)
        prefs.edit().putBoolean("enabled", snapshot.items.isNotEmpty())
            .putBoolean("briefEnabled", snapshot.daily.isNotEmpty()).apply()
        val wanted = snapshot.items.isNotEmpty() || snapshot.daily.isNotEmpty()
        if (!wanted && !(explicit && enabledNow)) return
        if (prefs.getBoolean("guided", false) && !(explicit && enabledNow)) return
        pending = true
        pendingNeedsExact = true
        resume()
    }
    fun consider(settings: SessionNotifySettings) {
        val wasEnabled = prefs.getBoolean("sessionEnabled", false)
        prefs.edit().putBoolean("sessionEnabled", settings.enabled).apply()
        if (!settings.enabled) {
            pendingSession = false
            if (!pendingNeedsExact) pending = false
            return
        }
        if (wasEnabled && prefs.getBoolean("sessionGuided", false)) return
        pendingSession = true
        pending = true
        resume()
    }
    fun resume() {
        if ((!pending && !pendingExact) || !visible() || notificationPending || dialog != null) return
        if (pendingExact) {
            pendingExact = false
            exact()
            return
        }
        pending = false
        val needsExact = pendingNeedsExact
        pendingNeedsExact = false
        if (needsExact) prefs.edit().putBoolean("guided", true).apply()
        if (pendingSession) prefs.edit().putBoolean("sessionGuided", true).apply()
        pendingSession = false
        if (Build.VERSION.SDK_INT >= 33 && !ScheduledNotifyNotifications(activity).allowed()) {
            notificationPending = true
            notificationNeedsExact = needsExact
            requestGeneration = generation
            try { request.launch(Manifest.permission.POST_NOTIFICATIONS) }
            catch (_: RuntimeException) { notificationPending = false; if (needsExact) exact() }
        } else if (needsExact) exact()
    }
    private fun visible(): Boolean = !activity.isFinishing && !activity.isDestroyed && valid() &&
        activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
    private fun exact() {
        if (!visible()) { pendingExact = true; return }
        if (ScheduledNotifyScheduler(activity).exactAllowed()) return
        dialog = AlertDialog.Builder(activity).setTitle("允许准时提醒")
            .setMessage("请在系统设置中允许本应用的“闹钟和提醒”。未开启时仍会设置提醒，但可能延迟。三星手机还需将电池设为不受限制，并加入永不休眠的应用。")
            .setPositiveButton("打开设置") { _, _ ->
                if (Build.VERSION.SDK_INT >= 31) runCatching {
                    activity.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                        Uri.parse("package:${activity.packageName}")))
                }
            }.setNegativeButton("稍后", null).create().also {
                it.setOnDismissListener { dialog = null }
                it.show()
            }
    }
    fun clear() {
        generation++
        pending = false; pendingExact = false; pendingNeedsExact = false; pendingSession = false
        dialog?.dismiss(); dialog = null
    }
}
