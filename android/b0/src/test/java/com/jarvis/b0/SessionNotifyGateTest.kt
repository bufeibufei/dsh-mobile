package com.jarvis.b0

import com.google.gson.Gson
import org.junit.Assert.*
import org.junit.Test

class SessionNotifyGateTest {
    private fun event(kind: String = "reply", session: String = "fictional-session") =
        SessionNotice(1, session, "虚构会话", kind, "虚构预览", false)
    private val defaults = SessionNotifySettings()

    @Test fun allFourKindsAreSuppressedOnlyWhileViewingInForeground() {
        for (kind in listOf("approval", "question", "reply", "failed")) {
            val notice = event(kind)
            assertNull(SessionNotifyGate.decide(notice, defaults, true, notice.sessionId))
            assertNotNull(SessionNotifyGate.decide(notice, defaults, false, notice.sessionId))
            assertNotNull(SessionNotifyGate.decide(notice, defaults, true, "another"))
            assertNotNull(SessionNotifyGate.decide(notice, defaults, true, null))
        }
    }
    @Test fun attentionAlwaysKeepsHighChannelAndSound() {
        for (kind in listOf("approval", "question")) for (foreground in listOf(false, true)) {
            val decision = SessionNotifyGate.decide(event(kind), defaults, foreground, null)!!
            assertEquals(SessionNotifyGate.ATTENTION, decision.channel)
            assertFalse(decision.silent)
        }
    }
    @Test fun repliesAndFailuresUseDefaultChannelAndAreSilentOnlyInForeground() {
        for (kind in listOf("reply", "failed")) for (foreground in listOf(false, true)) {
            val decision = SessionNotifyGate.decide(event(kind), defaults, foreground, null)!!
            assertEquals(SessionNotifyGate.MESSAGES, decision.channel)
            assertEquals(foreground, decision.silent)
        }
    }
    @Test fun masterOffSuppressesEveryKind() {
        for (kind in listOf("reply", "failed", "approval", "question"))
            assertNull(SessionNotifyGate.decide(event(kind), defaults.copy(enabled = false), false, null))
    }
    @Test fun replySwitchDoesNotSuppressFailureOrAttention() {
        val settings = defaults.copy(notifyReplies = false)
        assertNull(SessionNotifyGate.decide(event(), settings, false, null))
        assertNull(SessionNotifyGate.decide(event().copy(automated = true), settings, false, null))
        for (kind in listOf("failed", "approval", "question"))
            assertNotNull(SessionNotifyGate.decide(event(kind), settings, false, null))
    }
    @Test fun unsupportedKindsNeverNotify() {
        for (kind in listOf("aborted", "blocked", "delta", "user", "life_record"))
            assertNull(SessionNotifyGate.decide(event(kind), defaults, false, null))
    }
    @Test fun lockscreenRedactionFollowsSettingForBothChannels() {
        for (kind in listOf("reply", "approval")) for (content in listOf(false, true))
            assertEquals(!content, SessionNotifyGate.decide(event(kind), defaults.copy(lockScreenContent = content), false, null)!!.publicVersion)
    }
    @Test fun backoffCapsAtSixtySecondsAndNetworkRecoveryResets() {
        val backoff = SessionNotifyBackoff()
        assertEquals(listOf(1000L, 2000L, 5000L, 10000L, 30000L, 60000L, 60000L),
            (1..7).map { backoff.nextMillis() })
        repeat(100) { assertEquals(60000L, backoff.nextMillis()) }
        backoff.reset()
        assertEquals(1000L, backoff.nextMillis())
    }
    @Test fun unauthorizedDisablesRestartsAndWarnsOnceAcrossPersistence() {
        val initial = SessionNotifyState().admitted("https://fictional.example/")
        assertTrue(SessionNotifyGate.warnUnauthorized(initial.loginWarned))
        val failed = initial.unauthorized()
        assertFalse(failed.authenticated)
        val restored = Gson().fromJson(Gson().toJson(failed), SessionNotifyState::class.java)
        assertFalse(SessionNotifyGate.warnUnauthorized(restored.unauthorized().loginWarned))
        assertFalse(restored.authenticated)
        val loggedIn = restored.admitted(initial.host!!)
        assertTrue(loggedIn.authenticated)
        assertTrue(SessionNotifyGate.warnUnauthorized(loggedIn.loginWarned))
    }
    @Test fun cursorAndEpochSurviveRestartAndSameEpochResetPreservesAfter() {
        val state = SessionNotifyState(cursor = SessionCursor(128, "epoch-1"))
        val restored = Gson().fromJson(Gson().toJson(state), SessionNotifyState::class.java)
        assertEquals(state, restored)
        assertFalse(restored.cursor.accepts(128)); assertFalse(restored.cursor.accepts(1))
        assertTrue(restored.cursor.accepts(129))
        assertEquals(restored.cursor, restored.cursor.reset(SessionNotifyReset("epoch-1", 150)))
        assertEquals(SessionCursor(0, "epoch-1"), SessionCursor(0, "epoch-1").reset(SessionNotifyReset("epoch-1", 150)))
    }
    @Test fun sameEpochWithoutAfterUsesLast() {
        assertEquals(SessionCursor(150, "epoch-1"),
            SessionCursor(epoch = "epoch-1").reset(SessionNotifyReset("epoch-1", 150)))
    }
    @Test fun changedEpochWithAfterStartsAtZeroToAcceptReplay() {
        val reset = SessionCursor(128, "epoch-1").reset(SessionNotifyReset("epoch-2", 3))
        assertEquals(0L, reset.after); assertEquals("epoch-2", reset.epoch)
        assertTrue(reset.accepts(1)); assertFalse(reset.accepts(0))
        // Reconnect before replay arrives must retain zero, including across app restarts.
        val restored = Gson().fromJson(Gson().toJson(reset), SessionCursor::class.java)
        assertEquals(reset, restored.reset(SessionNotifyReset("epoch-2", 4)))
        assertEquals(SessionCursor(0, "epoch-3"), reset.reset(SessionNotifyReset("epoch-3", 5)))
        val received = reset.copy(after = 1)
        assertEquals(received, received.reset(SessionNotifyReset("epoch-2", 4)))
        assertFalse(received.accepts(1)); assertTrue(received.accepts(2))
    }
    @Test fun changedEpochWithoutAfterStartsAtLastWithoutOldNotifications() {
        for (cursor in listOf(SessionCursor(), SessionCursor(epoch = "old"))) {
            val reset = cursor.reset(SessionNotifyReset("epoch-1", 128))
            assertEquals(SessionCursor(128, "epoch-1"), reset)
            assertFalse(reset.accepts(128)); assertTrue(reset.accepts(129))
            assertEquals(reset, reset.reset(SessionNotifyReset("epoch-1", 150)))
            assertEquals(SessionCursor(0, "epoch-1"), cursor.reset(SessionNotifyReset("epoch-1", 0)))
        }
    }
    @Test fun newHostCannotInheritCursorOrDisabledSettings() {
        val state = SessionNotifyState(host = "old", settings = defaults.copy(enabled = false), cursor = SessionCursor(4, "old"))
        assertEquals(state.cursor, state.admitted("old").cursor)
        assertNull(state.admitted("new").cursor.after)
        assertTrue(state.admitted("new").settings.enabled)
    }
    @Test fun repliesMergeForTenSecondsWithLatestPreviewAndFixedIdentity() {
        val merge = SessionNotifyMerge()
        val first = merge.message(event(), 1000)
        val second = merge.message(event().copy(id = 2, preview = "最新"), 10999)
        assertEquals(first.tag, second.tag); assertEquals(first.id, second.id)
        assertEquals("最新（2 条新消息）", second.text)
        assertEquals(1, merge.message(event(), 11000).count)
    }
    @Test fun sessionsStaySeparateEvenWithJavaHashCollision() {
        val merge = SessionNotifyMerge()
        assertEquals("Aa".hashCode(), "BB".hashCode())
        assertNotEquals(merge.message(event(session = "Aa"), 1).tag, merge.message(event(session = "BB"), 1).tag)
        assertEquals(2, merge.message(event(session = "Aa"), 2).count)
    }
    @Test fun attentionReplacesReplyAndResetsMergeWindow() {
        val merge = SessionNotifyMerge()
        val reply = merge.message(event(), 1)
        val approval = merge.message(event("approval"), 2)
        assertEquals(reply.tag, approval.tag); assertEquals(reply.id, approval.id)
        assertEquals("需要你确认", approval.title)
        assertEquals(1, merge.message(event(), 3).count)
    }
    @Test fun openingSessionClearsItsMergeCountWithoutClearingAnother() {
        val merge = SessionNotifyMerge()
        merge.message(event(), 0); merge.message(event(session = "other"), 0)
        merge.clear(event().sessionId)
        assertEquals(1, merge.message(event(), 1).count)
        assertEquals(2, merge.message(event(session = "other"), 1).count)
        merge.clear()
        assertEquals(1, merge.message(event(session = "other"), 2).count)
    }
    @Test fun automatedAndFailureTextsAreRendered() {
        val merge = SessionNotifyMerge()
        assertEquals("自动任务 · 虚构会话", merge.message(event().copy(automated = true), 1).title)
        assertEquals("回复失败，点开查看", merge.message(event("failed"), 2).text)
        assertEquals("Jarvis 在问你", merge.message(event("question"), 3).title)
    }
    @Test fun bootEligibilityDependsOnLoginSettingsAndHostWithoutSdkRestriction() {
        for (authenticated in listOf(false, true)) for (enabled in listOf(false, true))
            for (selected in listOf(false, true)) {
                val state = SessionNotifyState(host = "https://fictional.example/",
                    authenticated = authenticated, settings = defaults.copy(enabled = enabled))
                assertEquals(authenticated && enabled && selected,
                    SessionNotifyGate.canBootStart(state, selected))
            }
    }
}
