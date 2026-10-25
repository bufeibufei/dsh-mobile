package com.jarvis.b0

/** Cancellation admission and successful completion share one atomic decision. */
internal class ExportTermination {
    @Volatile var cancelRequested = false
        private set
    private var terminal = false

    @Synchronized fun requestCancel(): Boolean {
        if (terminal) return false
        cancelRequested = true
        return true
    }

    @Synchronized fun commit(): Boolean {
        if (terminal || cancelRequested) return false
        terminal = true
        return true
    }

    @Synchronized fun finish(): Boolean {
        if (terminal) return false
        terminal = true
        return true
    }

    @Synchronized fun isTerminal(): Boolean = terminal
}
