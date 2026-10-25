package com.jarvis.b0

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserBackGateTest {
    @Test fun repeatedGestureCannotQueueAnotherHostBack() {
        val gate = BrowserBackGate()
        val first = gate.begin()
        assertNotNull(first)
        assertNull(gate.begin())
        assertTrue(gate.complete(first!!))
        assertNotNull(gate.begin())
    }

    @Test fun navigationRejectsOldCallbackAndAllowsNextGesture() {
        val gate = BrowserBackGate()
        val old = gate.begin()!!
        gate.invalidate()
        val current = gate.begin()!!
        assertFalse(gate.complete(old))
        assertNull(gate.begin())
        assertTrue(gate.complete(current))
    }

    @Test fun timedOutEvaluationDoesNotBlockFutureBack() {
        val gate = BrowserBackGate()
        val expired = gate.begin()!!
        assertTrue(gate.complete(expired))
        val next = gate.begin()!!
        assertFalse(gate.complete(expired))
        assertTrue(gate.complete(next))
    }
}
