package com.jarvis.b0

import android.content.Context
import android.content.Intent
import com.google.gson.Gson

/** Main-thread owner; persistent cursor belongs to one authenticated selected Host only. */
internal class SessionNotifyRuntime private constructor(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("b0-session-notify", Context.MODE_PRIVATE)
    private val gson = Gson()
    var state: SessionNotifyState = runCatching {
        gson.fromJson(prefs.getString("state", null), SessionNotifyState::class.java) ?: SessionNotifyState()
    }.getOrDefault(SessionNotifyState())
        private set
    var foreground = false
    var pageVisible = false
    var viewing: String? = null
        private set
    var onSettings: ((SessionNotifySettings) -> Unit)? = null
    var service: SessionNotifyService? = null
    val merge = SessionNotifyMerge()
    val notifications = SessionNotifyNotifications(app)

    fun save(next: SessionNotifyState) {
        check(prefs.edit().putString("state", gson.toJson(next)).commit())
        state = next
    }
    fun selected(): Boolean = state.host != null && state.host ==
        ServerCatalog(app.getSharedPreferences("b0-host", Context.MODE_PRIVATE)).selected()?.address

    fun prepareHost(host: HostAddress) {
        if (state.host != null && state.host != host.base.toASCIIString()) deactivate()
    }
    fun activate(host: HostAddress, confirmedLogin: Boolean = false) {
        prepareHost(host)
        if (confirmedLogin) {
            save(state.admitted(host.base.toASCIIString()))
            notifications.cancelStatus()
        }
        if (state.authenticated && selected()) start(refresh = confirmedLogin)
    }
    fun changed() {
        if (state.authenticated && selected()) start(refresh = true)
    }
    private fun start(refresh: Boolean) {
        service?.let { if (refresh) it.reconnect(); return }
        // A confirmed page/settings change must fetch even when the cached setting was disabled.
        if (!refresh && !state.settings.enabled) return
        try { app.startForegroundService(Intent(app, SessionNotifyService::class.java)) }
        catch (_: IllegalStateException) { notifications.resume(state.host) }
        catch (_: SecurityException) { notifications.resume(state.host) }
    }
    fun boot() {
        if (SessionNotifyGate.canBootStart(state, selected())) start(refresh = false)
    }
    fun deactivate() {
        service?.halt()
        app.stopService(Intent(app, SessionNotifyService::class.java))
        notifications.clearMessages(); notifications.cancelStatus()
        merge.clear(); viewing = null
        save(SessionNotifyState())
    }
    fun unauthorized() {
        if (state.host == null) return
        val warn = SessionNotifyGate.warnUnauthorized(state.loginWarned)
        save(state.unauthorized())
        service?.halt()
        notifications.clearMessages(); merge.clear()
        if (warn) notifications.login(state.host)
    }
    fun settings(settings: SessionNotifySettings) {
        save(state.copy(settings = settings))
        onSettings?.invoke(settings)
        if (!settings.enabled) {
            notifications.clearMessages(); merge.clear(); service?.halt()
        }
    }
    fun viewing(session: String?) {
        viewing = session
        if (session != null) { notifications.cancel(session); merge.clear(session) }
    }
    fun reset(reset: SessionNotifyReset) {
        if (state.cursor.epoch != reset.epoch) merge.clear()
        save(state.copy(cursor = state.cursor.reset(reset)))
    }
    fun receive(event: SessionNotice, locked: Boolean, now: Long) {
        if (!state.cursor.accepts(event.id)) return
        val decision = SessionNotifyGate.decide(event, state.settings, foreground && !locked,
            viewing.takeIf { pageVisible })
        if (decision != null) notifications.message(state.host!!, merge.message(event, now), event.sessionId, decision)
        // Suppressed/permission-denied events are consumed too; no stale notification flood on resume.
        save(state.copy(cursor = state.cursor.copy(after = event.id)))
    }
    companion object {
        @Volatile private var instance: SessionNotifyRuntime? = null
        fun get(context: Context): SessionNotifyRuntime = instance ?: synchronized(this) {
            instance ?: SessionNotifyRuntime(context).also { instance = it }
        }
    }
}
