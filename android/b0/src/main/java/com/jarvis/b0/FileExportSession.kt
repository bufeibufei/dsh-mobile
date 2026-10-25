package com.jarvis.b0

import java.io.OutputStream
import java.util.Base64

internal class ExportFailure(val code: String) : Exception(code)

/** A bounded, ordered write transaction; no path, network, or model operations. */
internal class FileExportSession(val byteLength: Int, private val output: OutputStream) {
    var nextSeq = 0; private set
    var bytesWritten = 0; private set
    private var closed = false

    init { if (byteLength !in 0..MAX_FILE_BYTES) throw ExportFailure("INVALID_METADATA") }

    fun chunk(seq: Int, encoded: String) {
        if (closed || seq != nextSeq || encoded.length > MAX_BASE64_CHARS)
            throw ExportFailure("INVALID_CHUNK")
        val bytes = try { Base64.getDecoder().decode(encoded) }
            catch (_: IllegalArgumentException) { throw ExportFailure("INVALID_CHUNK") }
        // Canonical Base64 also rejects invalid trailing bits and missing padding.
        if (bytes.size > MAX_CHUNK_BYTES || Base64.getEncoder().encodeToString(bytes) != encoded)
            throw ExportFailure("INVALID_CHUNK")
        if (bytesWritten + bytes.size > byteLength) throw ExportFailure("SIZE_MISMATCH")
        try { output.write(bytes) } catch (_: Exception) { throw ExportFailure("WRITE_FAILED") }
        bytesWritten += bytes.size
        nextSeq++
    }

    fun commit() {
        if (closed || bytesWritten != byteLength) throw ExportFailure("SIZE_MISMATCH")
        try { output.flush(); output.close(); closed = true }
        catch (_: Exception) { throw ExportFailure("WRITE_FAILED") }
    }

    fun cancel() { if (!closed) { closed = true; runCatching { output.close() } } }

    companion object {
        const val MAX_FILE_BYTES = 16 * 1024 * 1024
        const val MAX_CHUNK_BYTES = 64 * 1024
        const val MAX_BASE64_CHARS = ((MAX_CHUNK_BYTES + 2) / 3) * 4
    }
}
