package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream

class ExportRequestKeyTest {
    @Test fun unrelatedBusyRequestCannotCloseOrDeleteTheValidExport() {
        val a = ExportRequestKey("91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd", 8)
        val b = ExportRequestKey("eb32cc0b-dcc0-46ca-86ee-36ee46cf0bda", 8)
        var closes = 0
        val bytes = object : ByteArrayOutputStream() { override fun close() { closes++ } }
        val active = FileExportSession(7, bytes)
        active.chunk(0, "5L2g")
        if (b.mayCancel(a)) active.cancel()
        assertEquals(0, closes)
        active.chunk(1, "5aW9Cg==")
        active.commit()
        assertEquals(1, closes)
        assertArrayEquals("你好\n".toByteArray(Charsets.UTF_8), bytes.toByteArray())
    }

    @Test fun sameIdFromAnOldPageCannotCancelTheNewPageExport() {
        val current = ExportRequestKey("91e35d21-ddbd-4ba0-a7f5-e7f3245ce7fd", 9)
        assertFalse(current.copy(generation = 8).mayCancel(current))
        assertFalse(current.mayCancel(null))
        assertTrue(current.mayCancel(current))
    }
}
