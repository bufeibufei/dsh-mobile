package com.jarvis.b0

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.WebView
import org.json.JSONObject

/** Host-bound, bounded plugin-readiness wait, integrated with the Activity lifecycle. */
internal class SessionNotifyNavigation(private val notice: (String) -> Unit) {
    private var targetHost: String? = null
    private var session: String? = null
    private var serial = 0L
    private val handler = Handler(Looper.getMainLooper())
    fun read(intent: Intent, saved: Bundle? = null) {
        clear()
        targetHost = saved?.getString(HOST) ?: intent.getStringExtra(HOST)
        session = saved?.getString(SESSION) ?: intent.getStringExtra(SESSION)
        intent.removeExtra(HOST); intent.removeExtra(SESSION)
    }
    fun save(bundle: Bundle) { bundle.putString(HOST, targetHost); bundle.putString(SESSION, session) }
    fun open(browser: WebView, host: HostAddress, valid: () -> Boolean) {
        val id = session ?: return
        if (targetHost != host.base.toASCIIString()) {
            clear(); notice("这条通知属于其他服务器，请切回对应服务器查看。")
            return
        }
        stop()
        val ticket = serial
        val deadline = SystemClock.elapsedRealtime() + 10_000
        val script = """
            (() => {
              if (location.origin !== ${JSONObject.quote(host.origin)}) return false;
              return window.__JARVIS_B0_MOBILE__?.openSession?.(${JSONObject.quote(id)}) === true;
            })()
        """.trimIndent()
        val timeout = Runnable {
            if (ticket == serial) { stop(); notice("会话页面尚未加载完成，请稍后返回 App 重试。") }
        }
        handler.postDelayed(timeout, 10_000)
        fun attempt() {
            if (ticket != serial || !valid() || SystemClock.elapsedRealtime() >= deadline) return
            browser.evaluateJavascript(script) { result ->
                if (ticket != serial || !valid()) return@evaluateJavascript
                if (result == "true") clear()
                else handler.postDelayed({ attempt() }, 250)
            }
        }
        attempt()
    }
    fun stop() { serial++; handler.removeCallbacksAndMessages(null) }
    fun clear() { stop(); targetHost = null; session = null }
    companion object {
        private const val HOST = "sessionNotifyHost"
        private const val SESSION = "sessionNotifySession"
    }
}
