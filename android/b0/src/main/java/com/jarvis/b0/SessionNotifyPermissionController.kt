package com.jarvis.b0

import android.Manifest
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle

/** Ask only in the foreground when session notifications are first enabled or re-enabled. */
internal class SessionNotifyPermissionController(
    private val activity: ComponentActivity, private val valid: () -> Boolean
) {
    // Retain the existing preference file so upgrading does not re-prompt users
    // who already declined session notification permission. Only session keys are used.
    private val prefs by lazy { activity.getSharedPreferences("b0-reminder-permissions", 0) }
    private var pending = false
    private var notificationPending = false
    private var generation = 0L
    private var requestGeneration = 0L
    private val request = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        notificationPending = false
        if (requestGeneration == generation) resume()
    }

    fun consider(settings: SessionNotifySettings) {
        val wasEnabled = prefs.getBoolean("sessionEnabled", false)
        prefs.edit().putBoolean("sessionEnabled", settings.enabled).apply()
        if (!settings.enabled) { pending = false; return }
        if (wasEnabled && prefs.getBoolean("sessionGuided", false)) return
        pending = true
        resume()
    }

    fun resume() {
        if (!pending || notificationPending || activity.isFinishing || activity.isDestroyed ||
            !valid() || !activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return
        pending = false
        prefs.edit().putBoolean("sessionGuided", true).apply()
        val allowed = activity.getSystemService(NotificationManager::class.java).areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(activity,
                Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
        if (Build.VERSION.SDK_INT >= 33 && !allowed) {
            notificationPending = true
            requestGeneration = generation
            try { request.launch(Manifest.permission.POST_NOTIFICATIONS) }
            catch (_: RuntimeException) { notificationPending = false }
        }
    }

    fun clear() { generation++; pending = false }
}
