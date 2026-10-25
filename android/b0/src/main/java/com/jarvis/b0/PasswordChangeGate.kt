package com.jarvis.b0

/** Process-scoped handoff for an HTTP request that may outlive an Activity rotation. */
internal class PasswordChangeGate {
    private var running = false
    private var result: PasswordChangeOutcome? = null

    @Synchronized fun begin(): Boolean {
        if (running || result != null) return false
        running = true
        result = null
        return true
    }

    @Synchronized fun complete(outcome: PasswordChangeOutcome) {
        result = outcome
        running = false
    }

    @Synchronized fun abortBeforeSend() {
        running = false
        result = null
    }

    @Synchronized fun isRunning(): Boolean = running
    @Synchronized fun isBlocked(): Boolean = running || result != null
    @Synchronized fun result(): PasswordChangeOutcome? = result
    @Synchronized fun clearResult() { if (!running) result = null }
}

internal val passwordChangeGate = PasswordChangeGate()
