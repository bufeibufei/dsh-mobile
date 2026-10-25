package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test

class HostAddressTest {
    @Test fun localDevelopmentAddressStaysAtCleanRoot() {
        val host = HostAddress.parse("http://10.0.2.2:19200/")
        assertEquals("http://10.0.2.2:19200/", host.base.toASCIIString())
    }

    @Test fun legacyLocalSubpathSurvivesServerCatalogNormalization() {
        val host = HostAddress.parse("http://127.0.0.1:19210/dsh/")
        assertEquals("http://127.0.0.1:19210/dsh/", host.base.toASCIIString())
        assertEquals("http://127.0.0.1:19210", host.origin)
        assertTrue(host.owns("http://127.0.0.1:19210/jarvis-auth"))
    }

    @Test fun hostCredentialsAndRemoteCleartextCannotBecomeSavedAddress() {
        for (url in listOf("https://user:secret@example.org/", "https://example.org/?token=secret",
            "https://example.org/#secret", "http://192.168.1.2:3200/", "http://10.0.2.2:3081/",
            "file:///etc/passwd", "javascript:alert(1)", "https://example.org/foo/",
            "http://127.0.0.1:19210/../dsh/", "http://127.0.0.1:19210/%2e%2e/dsh/",
            "http://127.0.0.1:19210/dsh%2Fadmin/")) {
            assertTrue(url, runCatching { HostAddress.parse(url) }.isFailure)
        }
    }

    @Test fun navigationUsesExactOriginIncludingPortWithoutCredentials() {
        val host = HostAddress.parse("https://dsh.example.org/")
        assertTrue(host.owns("https://dsh.example.org:443/api"))
        assertFalse(host.owns("https://dsh.example.org.evil.test/"))
        assertFalse(host.owns("https://dsh.example.org:444/"))
        assertFalse(host.owns("https://secret@dsh.example.org/"))
        assertFalse(host.owns("http://dsh.example.org/"))
    }

    @Test fun publicIpRequiresHttpsAndKeepsTokenOutOfSavedAddress() {
        val host = HostAddress.parse("https://203.0.113.10/")
        assertEquals("https://203.0.113.10/", host.base.toASCIIString())
        assertTrue(host.owns("https://203.0.113.10/workspace"))
        assertFalse(host.owns("http://203.0.113.10/workspace"))
        assertTrue(runCatching { HostAddress.parse("http://203.0.113.10/") }.isFailure)
    }
}
