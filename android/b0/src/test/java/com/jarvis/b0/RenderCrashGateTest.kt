package com.jarvis.b0

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RenderCrashGateTest {
    @Test fun thirdCrashWithinAMinuteStopsAutomaticRecovery() {
        val gate = RenderCrashGate()
        assertTrue(gate.shouldReload(0))
        assertTrue(gate.shouldReload(10_000))
        assertFalse(gate.shouldReload(59_999))
        assertTrue(gate.stopped)
        assertFalse(gate.shouldReload(120_000))
    }

    @Test fun oldCrashesExpireInARollingWindow() {
        val gate = RenderCrashGate()
        assertTrue(gate.shouldReload(0))
        assertTrue(gate.shouldReload(50_000))
        assertTrue(gate.shouldReload(60_001))
        assertFalse(gate.shouldReload(60_002))
    }

    @Test fun exactMinuteBoundaryExpiresAndQuietMinutesDoNotAccumulate() {
        val gate = RenderCrashGate()
        assertTrue(gate.shouldReload(0))
        assertTrue(gate.shouldReload(1))
        assertTrue(gate.shouldReload(60_000))
        assertTrue(gate.shouldReload(120_000))
    }

    @Test fun explicitRetryClearsTheStopAndAllTimestamps() {
        val gate = RenderCrashGate()
        repeat(3) { gate.shouldReload(it.toLong()) }
        gate.reset()
        assertFalse(gate.stopped)
        assertTrue(gate.shouldReload(3))
        assertTrue(gate.shouldReload(4))
        assertFalse(gate.shouldReload(5))
    }

    @Test fun retryAlsoClearsPartialHistory() {
        val gate = RenderCrashGate()
        gate.shouldReload(0)
        gate.reset()
        assertTrue(gate.shouldReload(1))
        assertTrue(gate.shouldReload(2))
        assertFalse(gate.shouldReload(3))
    }
}
