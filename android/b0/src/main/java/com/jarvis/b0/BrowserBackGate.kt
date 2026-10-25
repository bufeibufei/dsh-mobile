package com.jarvis.b0

/** Allows one outstanding WebView back query; stale callbacks cannot act on a new page. */
internal class BrowserBackGate {
    private var serial = 0L
    private var pending: Long? = null

    fun begin(): Long? {
        if (pending != null) return null
        serial++
        pending = serial
        return serial
    }

    fun complete(token: Long): Boolean {
        if (pending != token) return false
        pending = null
        return true
    }

    fun invalidate() {
        serial++
        pending = null
    }
}
