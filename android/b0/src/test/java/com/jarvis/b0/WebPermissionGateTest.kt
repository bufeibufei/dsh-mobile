package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test

class WebPermissionGateTest {
    private val host = HostAddress.parse("https://jarvis.example:8443/")
    private val audio = WebPermissionGate.Kind.AUDIO
    private val location = WebPermissionGate.Kind.LOCATION
    private val audioResources = setOf(WebPermissionGate.AUDIO_CAPTURE)
    private val none = WebPermissionGate.Permissions()

    @Test fun onlyCurrentForegroundSameOriginPageIsTrusted() {
        assertTrue(WebPermissionGate.trusted(host, host.origin, "${host.origin}/chat", true, true))
        for (origin in listOf("https://foreign.example:8443", "https://jarvis.example:8444",
            "http://jarvis.example:8443", "https://user@jarvis.example:8443", "null", "invalid")) {
            assertFalse(WebPermissionGate.trusted(host, origin, host.origin, true, true))
        }
        assertFalse(WebPermissionGate.trusted(null, host.origin, host.origin, true, true))
        assertFalse(WebPermissionGate.trusted(host, host.origin, "https://foreign.example/", true, true))
        assertFalse(WebPermissionGate.trusted(host, host.origin, null, true, true))
        assertFalse(WebPermissionGate.trusted(host, host.origin, host.origin, false, true))
        assertFalse(WebPermissionGate.trusted(host, host.origin, host.origin, true, false))
        val defaultPort = HostAddress.parse("https://jarvis.example/")
        assertTrue(WebPermissionGate.trusted(defaultPort, "https://JARVIS.example:443", defaultPort.origin, true, true))
    }

    @Test fun cameraMixedUnknownAndEmptyResourcesAreDeniedWithoutSystemPrompt() {
        val gate = WebPermissionGate()
        for (resources in listOf(emptySet(), setOf("android.webkit.resource.VIDEO_CAPTURE"),
            audioResources + "android.webkit.resource.VIDEO_CAPTURE", audioResources + "future.resource")) {
            val results = mutableListOf<WebPermissionGate.Result>()
            assertNull(gate.request(Any(), audio, resources, none, { true }, results::add))
            assertEquals(listOf(WebPermissionGate.Result(false)), results)
        }
    }

    @Test fun untrustedAudioAndLocationNeverPromptEvenWithSystemPermissions() {
        val gate = WebPermissionGate()
        for (kind in listOf(audio, location)) {
            val results = mutableListOf<WebPermissionGate.Result>()
            assertNull(gate.request(Any(), kind, if (kind == audio) audioResources else emptySet(),
                WebPermissionGate.Permissions(true, true, true), { false }, results::add))
            assertEquals(listOf(WebPermissionGate.Result(false)), results)
        }
    }

    @Test fun alreadyGrantedAudioDoesNotLaunchSystemDialog() {
        val results = mutableListOf<WebPermissionGate.Result>()
        assertNull(WebPermissionGate().request(Any(), audio, audioResources,
            WebPermissionGate.Permissions(audio = true), { true }, results::add))
        assertEquals(listOf(WebPermissionGate.Result(true)), results)
    }

    @Test fun audioGrantAndDenialCompleteExactlyOnce() {
        for (granted in listOf(true, false)) {
            val gate = WebPermissionGate()
            val results = mutableListOf<WebPermissionGate.Result>()
            val token = gate.request(Any(), audio, audioResources, none, { true }, results::add)!!
            assertTrue(results.isEmpty())
            assertEquals(if (granted) null else audio,
                gate.complete(token, WebPermissionGate.Permissions(audio = granted)))
            assertEquals(listOf(WebPermissionGate.Result(granted)), results)
            assertNull(gate.complete(token, WebPermissionGate.Permissions(audio = true)))
            assertEquals(1, results.size)
        }
    }

    @Test fun approximateOrPreciseLocationWorksAndNeverRetainsWebPermission() {
        for (permissions in listOf(WebPermissionGate.Permissions(coarse = true),
            WebPermissionGate.Permissions(fine = true), WebPermissionGate.Permissions(coarse = true, fine = true), none)) {
            val gate = WebPermissionGate()
            val results = mutableListOf<WebPermissionGate.Result>()
            val token = gate.request(Any(), location, emptySet(), none, { true }, results::add)!!
            gate.complete(token, permissions)
            assertEquals(listOf(WebPermissionGate.Result(permissions.coarse || permissions.fine, false)), results)
            results.clear()
            val next = gate.request(Any(), location, emptySet(), permissions, { true }, results::add)
            if (permissions.coarse || permissions.fine) {
                assertNull(next)
                assertEquals(listOf(WebPermissionGate.Result(true, false)), results)
            } else assertNotNull(next)
        }
    }

    @Test fun cancellationDeniesAndLateGrantCannotAuthorizeNewPage() {
        val gate = WebPermissionGate()
        val results = mutableListOf<WebPermissionGate.Result>()
        val token = gate.request(Any(), audio, audioResources, none, { true }, results::add)!!
        gate.cancel()
        gate.cancel()
        assertEquals(listOf(WebPermissionGate.Result(false)), results)
        val blocked = mutableListOf<WebPermissionGate.Result>()
        assertNull(gate.request(Any(), location, emptySet(), none, { true }, blocked::add))
        assertEquals(listOf(WebPermissionGate.Result(false)), blocked)
        assertNull(gate.complete(token, WebPermissionGate.Permissions(audio = true)))
        assertEquals(1, results.size)
        val next = gate.request(Any(), location, emptySet(), none, { true }, results::add)!!
        gate.complete(token, WebPermissionGate.Permissions(fine = true))
        assertEquals(1, results.size)
        gate.complete(next, WebPermissionGate.Permissions(coarse = true))
        assertEquals(WebPermissionGate.Result(true, false), results.last())
    }

    @Test fun newRequestCannotReplacePendingRequest() {
        val gate = WebPermissionGate()
        val first = mutableListOf<WebPermissionGate.Result>()
        val second = mutableListOf<WebPermissionGate.Result>()
        val token = gate.request(Any(), audio, audioResources, none, { true }, first::add)!!
        assertNull(gate.request(Any(), location, emptySet(), none, { true }, second::add))
        assertTrue(first.isEmpty())
        assertEquals(listOf(WebPermissionGate.Result(false)), second)
        gate.complete(token, WebPermissionGate.Permissions(audio = true))
        assertEquals(listOf(WebPermissionGate.Result(true)), first)
    }

    @Test fun hideOrCancelOnlyAffectsMatchingIdentityAndKind() {
        val gate = WebPermissionGate()
        val view = Any()
        val results = mutableListOf<WebPermissionGate.Result>()
        val token = gate.request(view, location, emptySet(), none, { true }, results::add)!!
        gate.cancel(Any(), location)
        gate.cancel(view, audio)
        assertTrue(results.isEmpty())
        gate.cancel(view, location)
        gate.complete(token, WebPermissionGate.Permissions(fine = true))
        assertEquals(listOf(WebPermissionGate.Result(false, false)), results)
    }

    @Test fun pageBrowserHostOrForegroundChangeIsRecheckedAtCompletion() {
        val gate = WebPermissionGate()
        var current = true
        val results = mutableListOf<WebPermissionGate.Result>()
        val token = gate.request(Any(), audio, audioResources, none, { current }, results::add)!!
        current = false
        assertNull(gate.complete(token, WebPermissionGate.Permissions(audio = true)))
        assertEquals(listOf(WebPermissionGate.Result(false)), results)
    }

    @Test fun permissionRevocationIsNotHiddenByPreviousGrant() {
        val gate = WebPermissionGate()
        val results = mutableListOf<WebPermissionGate.Result>()
        gate.request(Any(), audio, audioResources, WebPermissionGate.Permissions(audio = true), { true }, results::add)
        val token = gate.request(Any(), audio, audioResources, none, { true }, results::add)!!
        gate.complete(token, none)
        assertEquals(listOf(WebPermissionGate.Result(true), WebPermissionGate.Result(false)), results)
    }
}
