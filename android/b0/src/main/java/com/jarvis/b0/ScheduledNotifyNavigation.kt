package com.jarvis.b0

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import org.json.JSONObject

/** Retry the provider's optional page handler, fenced to the selected Host. */
internal class ScheduledNotifyNavigation(private val notice: (String) -> Unit) {
    private var targetHost: String? = null
    private var key: String? = null
    private var open: String? = null
    private var serial = 0L
    private val handler = Handler(Looper.getMainLooper())
    fun read(intent: Intent, saved: Bundle? = null) {
        targetHost = saved?.getString("scheduleHost") ?: intent.getStringExtra("scheduleHost")
        key = saved?.getString("scheduleKey") ?: intent.getStringExtra("scheduleKey")
        open = saved?.getString("scheduleOpen") ?: intent.getStringExtra("scheduleOpen")
        listOf("scheduleHost", "scheduleKey", "scheduleOpen").forEach(intent::removeExtra)
    }
    fun save(bundle: Bundle) {
        bundle.putString("scheduleHost", targetHost); bundle.putString("scheduleKey", key); bundle.putString("scheduleOpen", open)
    }
    fun open(browser: WebView, host: HostAddress, valid: () -> Boolean) {
        val target = targetHost ?: return
        if (target != host.base.toASCIIString()) {
            clear(); notice("这条通知属于其他服务器，请切回对应服务器查看。"); return
        }
        stop()
        val payload = open ?: run { clear(); return }
        val provider = key?.substringBefore('/') ?: run { clear(); return }
        val ticket = serial
        val script = """
            (() => {
              if (location.origin !== ${JSONObject.quote(host.origin)}) return false;
              try { return window.__DSH_MOBILE_OPEN__?.[${JSONObject.quote(provider)}]?.(${JSONObject.quote(payload)}) === true; }
              catch { return false; }
            })()
        """.trimIndent()
        fun attempt(left: Int) {
            if (ticket != serial || !valid()) return
            browser.evaluateJavascript(script) { result ->
                if (ticket != serial || !valid()) return@evaluateJavascript
                if (result == "true") clear()
                else if (left > 0) handler.postDelayed({ attempt(left - 1) }, 250)
                else { clear(); notice("页面尚未加载完成，请重新打开通知。") }
            }
        }
        attempt(120)
    }
    fun stop() { serial++; handler.removeCallbacksAndMessages(null) }
    fun clear() { stop(); targetHost = null; key = null; open = null }
}
