package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test

class NativeSettingsMessageTest {
    private val host = HostAddress.parse("https://example.org:8443/")
    private fun resolve(
        value: String? = "account", source: String = host.origin,
        selected: HostAddress? = host, top: String? = "https://example.org:8443/settings",
        string: Boolean = true, main: Boolean = true, generation: Boolean = true,
        login: Boolean = false, blocked: Boolean = false
    ) = NativeSettingsMessage.resolve(value, source, host, selected, top, string, main, generation, login, blocked)

    @Test fun acceptsOnlyThreeExactCommandsFromCurrentPage() {
        assertEquals(NativeSettingsPage.ACCOUNT, resolve())
        assertEquals(NativeSettingsPage.SERVERS, resolve(value = "servers"))
        assertEquals(NativeSettingsPage.CONNECTION, resolve(value = "connection"))
        assertNull(resolve(value = "logout"))
        assertNull(resolve(value = "account:secret"))
    }

    @Test fun rejectsSubframesOldOriginsAndBlockedStates() {
        assertNull(resolve(main = false))
        assertNull(resolve(string = false))
        assertNull(resolve(source = "https://evil.example"))
        assertNull(resolve(selected = HostAddress.parse("https://other.example/")))
        assertNull(resolve(top = "https://example.org.evil.test/"))
        assertNull(resolve(generation = false))
        assertNull(resolve(login = true))
        assertNull(resolve(blocked = true))
    }
}
