package com.jarvis.b0

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionCallbackGateTest {
    @Test fun switchedServerRejectsLateCallback() {
        val next = HostAddress.parse("https://next.example:8443/")
        assertFalse(acceptsConnectionCallback(3, 4, next, "https://old.example:8443/"))
        assertFalse(acceptsConnectionCallback(4, 4, next, "https://old.example:8443/"))
        assertTrue(acceptsConnectionCallback(4, 4, next, "https://next.example:8443/"))
    }

    @Test fun retryRejectsPreviousAttemptAtSameOrigin() {
        val host = HostAddress.parse("https://host.example:8443/")
        assertFalse(acceptsConnectionCallback(7, 8, host, "https://host.example:8443/"))
        assertTrue(acceptsConnectionCallback(8, 8, host, "https://host.example:8443/"))
    }

    @Test fun oldTlsResourceCannotBorrowNewPageUrl() {
        val next = HostAddress.parse("https://next.example:8443/")
        assertFalse(acceptsSslFailure(4, 4, next,
            "https://old.example:8443/asset.js", "https://next.example:8443/"))
        assertTrue(acceptsSslFailure(4, 4, next,
            "https://next.example:8443/asset.js", "https://next.example:8443/"))
        assertTrue(acceptsSslFailure(4, 4, next, null, "https://next.example:8443/"))
    }
}
