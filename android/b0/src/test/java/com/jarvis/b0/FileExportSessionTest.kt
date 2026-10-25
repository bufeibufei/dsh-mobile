package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.util.Base64

class FileExportSessionTest {
    private fun fails(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch (error: ExportFailure) { assertEquals(code, error.code) }
    }

    @Test fun exactChineseSampleIsSevenBytesAndCommits() {
        val bytes = ByteArrayOutputStream()
        val export = FileExportSession(7, bytes)
        export.chunk(0, "5L2g5aW9Cg==")
        assertEquals(7, export.bytesWritten)
        assertEquals(1, export.nextSeq)
        export.commit()
        assertArrayEquals("你好\n".toByteArray(Charsets.UTF_8), bytes.toByteArray())
        fails("INVALID_CHUNK") { export.chunk(1, "AA==") }
    }

    @Test fun skippedRepeatedAndMalformedChunksNeverWriteExtraBytes() {
        val bytes = ByteArrayOutputStream(); val export = FileExportSession(2, bytes)
        fails("INVALID_CHUNK") { export.chunk(1, "YQ==") }
        fails("INVALID_CHUNK") { export.chunk(0, "not base64!") }
        fails("INVALID_CHUNK") { export.chunk(0, "YR==") }
        export.chunk(0, "YQ==")
        fails("INVALID_CHUNK") { export.chunk(0, "Yg==") }
        assertArrayEquals(byteArrayOf(97), bytes.toByteArray())
    }

    @Test fun lengthAndChunkLimitsAreEnforcedBeforeWriting() {
        val bytes = ByteArrayOutputStream(); val export = FileExportSession(1, bytes)
        fails("SIZE_MISMATCH") { export.chunk(0, "YWI=") }
        fails("INVALID_CHUNK") { export.chunk(0, Base64.getEncoder().encodeToString(ByteArray(65537))) }
        assertEquals(0, bytes.size())
        fails("SIZE_MISMATCH") { export.commit() }
        fails("INVALID_METADATA") { FileExportSession(16777217, bytes) }
    }

    @Test fun cancellationClosesAndDisallowsFurtherWrites() {
        var closes = 0
        val output = object : ByteArrayOutputStream() { override fun close() { closes++ } }
        val export = FileExportSession(1, output)
        export.cancel(); export.cancel()
        assertEquals(1, closes)
        fails("INVALID_CHUNK") { export.chunk(0, "YQ==") }
        assertEquals(0, output.size())
    }

    @Test fun ioFailureNeverAdvancesAcknowledgedByteCount() {
        val export = FileExportSession(1, object : OutputStream() {
            override fun write(value: Int) { throw IOException("fictional failure") }
        })
        fails("WRITE_FAILED") { export.chunk(0, "YQ==") }
        assertEquals(0, export.bytesWritten)
        assertEquals(0, export.nextSeq)
    }
}
