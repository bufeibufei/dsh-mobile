package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test

class BrowserConnectionGateTest {
    @Test fun sameOriginReconnectRetainsCookiesButPortChangeClears() {
        val gate = BrowserConnectionGate("http://10.0.2.2:19200")
        val restore = gate.begin("http://10.0.2.2:19200")
        assertFalse(restore.mustClearCookies)
        assertTrue(gate.ready(restore))
        val otherPort = gate.begin("http://10.0.2.2:19201")
        assertTrue(otherPort.mustClearCookies)
        assertTrue(gate.ready(otherPort))
    }

    @Test fun lateCleanupCannotNavigateOldTargetOrEraseNewLoginBeforeReady() {
        val gate = BrowserConnectionGate("http://10.0.2.2:19200")
        val old = gate.begin("http://10.0.2.2:19201")
        val latest = gate.begin("http://10.0.2.2:19200")
        // Even returning to the original origin waits behind an already queued cleanup.
        assertTrue(latest.mustClearCookies)
        assertFalse(gate.ready(old))
        assertTrue(gate.ready(latest))
        assertFalse(gate.begin("http://10.0.2.2:19200").mustClearCookies)
    }

    @Test fun destroyedActivityCannotNavigateFromPendingCallback() {
        val gate = BrowserConnectionGate(null)
        val pending = gate.begin("https://dsh.example.org")
        assertTrue(pending.mustClearCookies)
        gate.invalidate()
        assertFalse(gate.ready(pending))
    }
}
