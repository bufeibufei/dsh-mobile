package com.jarvis.b0

/** A rolling minute, latched after the third crash until an explicit retry. */
internal class RenderCrashGate {
    private val crashes = ArrayDeque<Long>()
    var stopped: Boolean = false
        private set

    fun shouldReload(nowMillis: Long): Boolean {
        if (stopped) return false
        while (crashes.isNotEmpty() &&
            (nowMillis - crashes.first() >= 60_000 || nowMillis < crashes.first())) {
            crashes.removeFirst()
        }
        crashes.addLast(nowMillis)
        stopped = crashes.size >= 3
        return !stopped
    }

    fun reset() {
        crashes.clear()
        stopped = false
    }
}
