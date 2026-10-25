package com.jarvis.b0

import android.app.KeyguardManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.webkit.CookieManager
import java.net.HttpURLConnection
import java.util.concurrent.Executors

/** All lifecycle/state transitions are on main; blocking HTTP stays on cancellable worker attempts. */
class SessionNotifyService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val workers = Executors.newCachedThreadPool()
    private val backoff = SessionNotifyBackoff()
    private lateinit var runtime: SessionNotifyRuntime
    private lateinit var connectivity: ConnectivityManager
    private val lock = Any()
    @Volatile private var generation = 0L
    private var connection: HttpURLConnection? = null
    private var stopped = false
    private var registered = false
    private var network: Network? = null
    private var validated = false
    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(next: Network) { main.post {
            if (!stopped && network != next) {
                network = next
                validated = connectivity.getNetworkCapabilities(next)
                    ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
                reconnect()
            }
        } }
        override fun onCapabilitiesChanged(next: Network, caps: NetworkCapabilities) { main.post {
            if (!stopped && network == next) {
                val ready = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                val recovered = ready && !validated
                validated = ready
                if (recovered) reconnect()
            }
        } }
        override fun onLost(lost: Network) { main.post {
            if (network == lost) { network = null; validated = false }
        } }
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        runtime = SessionNotifyRuntime.get(this)
        connectivity = getSystemService(ConnectivityManager::class.java)
        runtime.service = this
        network = connectivity.activeNetwork
        validated = network?.let { connectivity.getNetworkCapabilities(it) }
            ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        runCatching { connectivity.registerDefaultNetworkCallback(callback); registered = true }
        enterForeground()
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!runtime.state.authenticated || !runtime.selected()) { halt(); return START_NOT_STICKY }
        if (stopped) {
            stopped = false
            runtime.service = this
            if (!enterForeground()) return START_NOT_STICKY
        }
        reconnect()
        return START_STICKY
    }
    internal fun reconnect() {
        if (stopped) return
        invalidate()
        backoff.reset()
        attempt(generation)
    }
    private fun enterForeground(): Boolean {
        try {
            val notification = runtime.notifications.keepAlive()
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(SessionNotifyNotifications.KEEP_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(SessionNotifyNotifications.KEEP_ID, notification)
            }
            return true
        } catch (_: IllegalStateException) {
            runtime.notifications.resume(runtime.state.host)
        } catch (_: SecurityException) {
            runtime.notifications.resume(runtime.state.host)
        }
        halt()
        return false
    }
    private fun invalidate() {
        main.removeCallbacksAndMessages(null)
        val old = synchronized(lock) { generation++; connection.also { connection = null } }
        // Platform disconnect may wait for a read lock; never block the UI thread.
        if (old != null) workers.execute { old.disconnect() }
    }
    private fun valid(ticket: Long) = !stopped && ticket == generation
    private fun deliver(ticket: Long, action: () -> Unit) {
        main.post { if (valid(ticket)) action() }
    }
    private fun attempt(ticket: Long) {
        if (!valid(ticket) || !runtime.state.authenticated || !runtime.selected()) { halt(); return }
        val host = runtime.state.host ?: return
        val origin = HostAddress.parse(host).origin
        val settingsUrl = "$origin/api/session-notify/settings"
        val cookie = CookieManager.getInstance().getCookie(settingsUrl).orEmpty()
        workers.execute {
            try {
                val settings = request(ticket, settingsUrl, cookie) { conn ->
                    val raw = conn.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                        val body = StringBuilder()
                        val buffer = CharArray(4096)
                        while (true) {
                            val n = reader.read(buffer)
                            if (n < 0) break
                            require(body.length + n <= 64 * 1024)
                            body.append(buffer, 0, n)
                        }
                        body.toString()
                    }
                    SessionNotifyWire.settings(raw)
                }
                deliver(ticket) {
                    runtime.settings(settings)
                    if (settings.enabled && valid(ticket)) stream(ticket, origin)
                }
            } catch (_: Unauthorized) { deliver(ticket) { runtime.unauthorized() } }
            catch (_: Exception) { retry(ticket) }
        }
    }
    private fun stream(ticket: Long, origin: String) {
        val url = SessionNotifyWire.streamUrl(origin, runtime.state.cursor)
        val cookie = CookieManager.getInstance().getCookie(url).orEmpty()
        workers.execute {
            try {
                request(ticket, url, cookie, streaming = true) { conn ->
                    require(conn.contentType?.substringBefore(';')?.trim()?.equals("text/event-stream", true) == true)
                    conn.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                        SessionNotifySse.read(reader, { generation == ticket },
                            heartbeat = { deliver(ticket) { backoff.reset() } }) { frame ->
                            when (frame.event) {
                                "reset" -> {
                                    val reset = SessionNotifyWire.reset(frame)
                                    deliver(ticket) { runtime.reset(reset) }
                                }
                                "notify" -> {
                                    val event = SessionNotifyWire.notice(frame)
                                    deliver(ticket) {
                                        runtime.receive(event, getSystemService(KeyguardManager::class.java).isKeyguardLocked,
                                            SystemClock.elapsedRealtime())
                                        backoff.reset()
                                    }
                                }
                            }
                        }
                    }
                }
                retry(ticket)
            } catch (_: Unauthorized) { deliver(ticket) { runtime.unauthorized() } }
            catch (_: Exception) { retry(ticket) }
        }
    }
    private class Unauthorized : Exception()
    private fun <T> request(ticket: Long, url: String, cookie: String, streaming: Boolean = false,
        read: (HttpURLConnection) -> T): T {
        val conn = HostHttp.open(url, cookie).apply {
            if (streaming) { readTimeout = 60_000; setRequestProperty("Accept", "text/event-stream") }
            useCaches = false
        }
        try {
            synchronized(lock) { check(ticket == generation); connection = conn }
            when (conn.responseCode) { 401 -> throw Unauthorized(); 200 -> Unit; else -> error("HTTP failure") }
            return read(conn)
        } finally {
            synchronized(lock) { if (connection === conn) connection = null }
            conn.disconnect()
        }
    }
    private fun retry(ticket: Long) = deliver(ticket) {
        main.postDelayed({ if (valid(ticket)) attempt(ticket) }, backoff.nextMillis())
    }
    internal fun halt() {
        if (stopped) return
        stopped = true
        invalidate()
        if (runtime.service === this) runtime.service = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }
    override fun onTimeout(startId: Int, fgsType: Int) {
        // Stop promptly if the system requests it; do not enter a restart loop.
        runtime.notifications.resume(runtime.state.host)
        halt()
    }
    override fun onDestroy() {
        halt()
        if (registered) runCatching { connectivity.unregisterNetworkCallback(callback) }
        workers.shutdownNow()
        super.onDestroy()
    }
}
