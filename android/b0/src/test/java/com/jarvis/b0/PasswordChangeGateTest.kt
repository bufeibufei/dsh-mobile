package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test

class PasswordChangeGateTest {
    @Test fun activityReplacementStillSeesRequestAndItsResult() {
        val gate = PasswordChangeGate()
        assertTrue(gate.begin())
        assertFalse(gate.begin())
        val replacementActivityView = gate
        assertTrue(replacementActivityView.isRunning())
        gate.complete(PasswordChangeOutcome.fromStatus(204))
        assertFalse(replacementActivityView.isRunning())
        assertTrue(replacementActivityView.isBlocked())
        assertTrue(replacementActivityView.result()!!.message.contains("已更新"))
        assertFalse(replacementActivityView.begin())
        replacementActivityView.clearResult()
        assertNull(gate.result())
        assertFalse(gate.isBlocked())
    }

    @Test fun failedDurablePreflightCanAbortWithoutARequest() {
        val gate = PasswordChangeGate()
        assertTrue(gate.begin())
        gate.abortBeforeSend()
        assertFalse(gate.isBlocked())
        assertNull(gate.result())
    }
}
