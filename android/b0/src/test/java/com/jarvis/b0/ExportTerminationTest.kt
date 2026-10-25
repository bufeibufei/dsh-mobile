package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class ExportTerminationTest {
    @Test fun acceptedCancelDuringFlushPreventsSuccessAndClosesOnlyOnce() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        var closes = 0
        val stream = object : ByteArrayOutputStream() {
            override fun flush() { entered.countDown(); check(release.await(5, TimeUnit.SECONDS)) }
            override fun close() { closes++ }
        }
        val session = FileExportSession(7, stream)
        session.chunk(0, "5L2g5aW9Cg==")
        val termination = ExportTermination()
        val result = AtomicReference<String>()
        val worker = Thread {
            try {
                session.commit()
                if (termination.commit()) result.set("success")
                else if (termination.finish()) { session.cancel(); result.set("cancelled") }
            } catch (error: Throwable) { result.set(error.toString()) }
        }
        worker.start()
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            assertTrue(termination.requestCancel())
        } finally { release.countDown() }
        worker.join(5000)
        assertFalse(worker.isAlive)
        assertEquals("cancelled", result.get())
        assertEquals(1, closes)
        assertFalse(termination.finish())
    }

    @Test fun completedSuccessCannotAcceptALateCancel() {
        val termination = ExportTermination()
        assertTrue(termination.commit())
        assertFalse(termination.requestCancel())
        assertFalse(termination.finish())
    }
}
