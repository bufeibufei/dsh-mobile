package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test

class PasswordChangeOutcomeTest {
    @Test fun successfulAndExpiredResponsesStayDistinct() {
        assertTrue(PasswordChangeOutcome.fromStatus(204).message.contains("已更新"))
        assertFalse(PasswordChangeOutcome.fromStatus(204).loginExpired)
        assertTrue(PasswordChangeOutcome.fromStatus(401).loginExpired)
    }

    @Test fun transportOrUnknownResponseNeverClaimsPasswordIsUnchanged() {
        assertTrue(PasswordChangeOutcome.unknown.message.contains("可能已修改"))
        assertEquals(PasswordChangeOutcome.unknown, PasswordChangeOutcome.fromStatus(500))
    }
}
