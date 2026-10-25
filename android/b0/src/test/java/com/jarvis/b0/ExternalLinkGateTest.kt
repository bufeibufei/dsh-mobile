package com.jarvis.b0

import org.junit.Assert.assertEquals
import org.junit.Test

class ExternalLinkGateTest {
    private val host = HostAddress.parse("https://host.example/")

    @Test fun sameOriginAllowsPathsQueriesAndDefaultPort() {
        val gate = ExternalLinkGate()
        listOf("https://host.example/", "https://host.example/chat?session=fictional#message",
            "https://HOST.example:443/other", "HTTPS://host.example/upper").forEach {
            assertEquals(it, ExternalLinkGate.Result.Allow, gate.check(host, it, 0))
        }
    }

    @Test fun differentSchemePortOrHostAsksForOnlyTheHost() {
        val gate = ExternalLinkGate()
        listOf("http://host.example/a", "https://host.example:8443/a",
            "https://host.example:80/a").forEach {
            assertEquals(ExternalLinkGate.Result.Ask("host.example"), gate.check(host, it, 0))
        }
        listOf("https://outside.example/private?token=fictional#secret",
            "http://outside.example/path").forEach {
            assertEquals(ExternalLinkGate.Result.Ask("outside.example"), gate.check(host, it, 0))
        }
    }

    @Test fun localHostAlsoComparesEffectivePort() {
        val local = HostAddress.parse("http://127.0.0.1:8080/")
        val gate = ExternalLinkGate()
        assertEquals(ExternalLinkGate.Result.Allow, gate.check(local, "http://127.0.0.1:8080/a?q=1", 0))
        assertEquals(ExternalLinkGate.Result.Ask("127.0.0.1"), gate.check(local, "http://127.0.0.1/a", 0))
    }

    @Test fun nonWebSchemesAndMalformedUrlsAreRejected() {
        val gate = ExternalLinkGate()
        listOf("intent://host.example/", "file:///tmp/a", "javascript:alert(1)",
            "data:text/html,test", "content://host.example/a", "custom://host.example/a",
            "mailto:test@example.com", "ftp://host.example/a", "about:blank", "", "/chat",
            "//outside.example/a", "https:", "https:///path", "https://", "not a url",
            "https://outside.example/%xx", "https://outside.example:bad/",
            "https://outside.example:65536/", "https://outside.example\\@host.example/",
            "https://host.example@outside.example/", "https://user:secret@host.example/").forEach {
            assertEquals(it, ExternalLinkGate.Result.Reject, gate.check(host, it, 0))
        }
    }

    @Test fun repeatedHostNavigationIsNeverDeduplicated() {
        val gate = ExternalLinkGate()
        val url = "https://host.example/chat"
        repeat(3) { assertEquals(ExternalLinkGate.Result.Allow, gate.check(host, url, 10L + it)) }
        // A host navigation does not consume the window of an external link either.
        assertEquals(ExternalLinkGate.Result.Ask("outside.example"),
            gate.check(host, "https://outside.example/a", 20))
    }

    @Test fun duplicatesAreRejectedForOneSecondWithoutExtendingTheWindow() {
        val gate = ExternalLinkGate()
        val url = "https://outside.example/a"
        val ask = ExternalLinkGate.Result.Ask("outside.example")
        assertEquals(ask, gate.check(host, url, 10))
        assertEquals(ExternalLinkGate.Result.Reject, gate.check(host, url, 11))
        assertEquals(ExternalLinkGate.Result.Reject, gate.check(host, url, 1009))
        assertEquals(ask, gate.check(host, url, 1010))
        assertEquals(ask, gate.check(host, url, 2011))
    }

    @Test fun interleavedLinksDoNotBypassDeduplication() {
        val gate = ExternalLinkGate()
        gate.check(host, "https://outside.example/a", 0)
        gate.check(host, "https://outside.example/b", 1)
        assertEquals(ExternalLinkGate.Result.Reject, gate.check(host, "https://outside.example/a", 2))
        assertEquals(ExternalLinkGate.Result.Allow, gate.check(host, "https://host.example/a", 3))
        // Host navigation is never deduplicated.
        assertEquals(ExternalLinkGate.Result.Allow, gate.check(host, "https://host.example/a", 4))
    }

    @Test fun missingHostCannotAllowNavigation() {
        assertEquals(ExternalLinkGate.Result.Ask("outside.example"),
            ExternalLinkGate().check(null, "https://outside.example/", 0))
    }
}
