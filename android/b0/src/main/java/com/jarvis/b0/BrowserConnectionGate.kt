package com.jarvis.b0

/** Cookie scope omits port; origin changes must complete cleanup before navigation. */
internal class BrowserConnectionGate(private var cookieOrigin: String?) {
    data class Attempt(val generation: Long, val origin: String, val mustClearCookies: Boolean)
    private var generation = 0L
    private var cleanupPending = false

    fun begin(origin: String): Attempt {
        val clear = cleanupPending || cookieOrigin != origin
        cleanupPending = cleanupPending || clear
        return Attempt(++generation, origin, clear)
    }

    fun ready(attempt: Attempt): Boolean {
        if (attempt.generation != generation) return false
        cleanupPending = false
        cookieOrigin = attempt.origin
        return true
    }

    fun invalidate() { generation++ }
}
