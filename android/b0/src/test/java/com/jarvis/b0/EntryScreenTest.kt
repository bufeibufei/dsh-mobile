package com.jarvis.b0

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EntryScreenTest {
    @Test fun recoveryHasNoCredentialOrRetryControls() {
        val copy = entryCopy(EntryScreen.RECOVERING)
        assertTrue(copy.showsProgress)
        assertFalse(copy.showsCredentials)
        assertNull(copy.primary)
        assertNull(copy.secondary)
    }

    @Test fun failureStatesOfferExactlyOnePrimaryAction() {
        for (screen in listOf(EntryScreen.OFFLINE, EntryScreen.SERVER_ERROR, EntryScreen.TLS)) {
            val copy = entryCopy(screen)
            assertFalse(copy.showsCredentials)
            assertFalse(copy.showsProgress)
            assertTrue(copy.primary!!.isNotEmpty())
        }
        assertEquals("检查服务器", entryCopy(EntryScreen.TLS).primary)
        assertNull(entryCopy(EntryScreen.TLS).secondary)
    }

    @Test fun onlyAuthenticationStatesShowTheForm() {
        for (screen in listOf(EntryScreen.LOGIN, EntryScreen.AUTHENTICATING, EntryScreen.EXPIRED,
            EntryScreen.CREDENTIAL_ERROR)) assertTrue(entryCopy(screen).showsCredentials)
        assertEquals("正在登录…", entryCopy(EntryScreen.AUTHENTICATING).primary)
        assertEquals("重新登录", entryCopy(EntryScreen.EXPIRED).primary)
    }
}
