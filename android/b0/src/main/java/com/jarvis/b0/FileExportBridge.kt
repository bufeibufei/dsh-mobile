package com.jarvis.b0

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import com.google.gson.JsonObject
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** Frozen B0 file-only channel. It cannot read paths, make network requests, or run models. */
internal class FileExportBridge(
    private val activity: ComponentActivity,
    private var browser: WebView,
    private val notice: (String) -> Unit,
    private val result: (String) -> Unit
) {
    val supported = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
    private var host: HostAddress? = null
    private var installed = false
    private var destroyed = false
    private val epoch = AtomicLong()
    private val worker = Executors.newSingleThreadExecutor()
    private val incoming = AtomicInteger()
    private val cleanupQueued = AtomicBoolean()
    private val overflowAbortQueued = AtomicBoolean()
    private val cancelQueued = AtomicBoolean()
    // Active transfer belongs to the serial worker. Picker association belongs to the UI thread.
    @Volatile private var active: Transfer? = null
    private var picking: Transfer? = null

    private inner class Reply(val id: String, val generation: Long, val proxy: JavaScriptReplyProxy) {
        fun send(status: String, vararg fields: Pair<String, Any>) {
            val message = JSONObject().put("v", 1).put("requestId", id).put("status", status)
            fields.forEach { message.put(it.first, it.second) }
            val feedback = FileExportFeedback.message(
                status, fields.any { it.first == "partialFileMayRemain" && it.second == true }
            )
            activity.runOnUiThread {
                if (!destroyed && epoch.get() == generation) {
                    proxy.postMessage(message.toString())
                    if (feedback != null) result(feedback)
                }
            }
        }
    }
    private class Transfer(val reply: Reply, val filename: String, val mime: String, val length: Int) {
        var uri: Uri? = null
        var session: FileExportSession? = null
        val termination = ExportTermination()
    }

    private val picker = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val transfer = picking
        picking = null
        val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
        execute {
            if (transfer == null) { if (uri != null) deleteOrNotice(uri); return@execute }
            transfer.uri = uri
            if (transfer.termination.isTerminal() || transfer.reply.generation != epoch.get()) {
                if (uri != null) deleteOrNotice(uri)
                return@execute
            }
            if (uri == null) { finish(transfer, "cancelled"); return@execute }
            try {
                val output = activity.contentResolver.openOutputStream(uri, "w") ?: throw ExportFailure("WRITE_FAILED")
                transfer.session = FileExportSession(transfer.length, output)
                transfer.reply.send("ready", "nextSeq" to 0)
            } catch (_: Exception) { finish(transfer, "error", "WRITE_FAILED") }
        }
    }

    fun bind(address: HostAddress) {
        invalidate()
        if (installed) { WebViewCompat.removeWebMessageListener(browser, CHANNEL); installed = false }
        host = address
        if (!supported) return
        WebViewCompat.addWebMessageListener(browser, CHANNEL, setOf(address.origin)) { view, message, origin, main, proxy ->
            if (destroyed || view !== browser || !main || host?.owns(origin.toString()) != true ||
                host?.owns(browser.url.orEmpty()) != true || message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
            val raw = message.data ?: return@addWebMessageListener
            if (raw.length > MAX_MESSAGE_BYTES || raw.toByteArray(Charsets.UTF_8).size > MAX_MESSAGE_BYTES) return@addWebMessageListener
            val json = StrictExportJson.parse(raw) ?: return@addWebMessageListener
            val id = StrictExportJson.string(json, "requestId") ?: return@addWebMessageListener
            if (!UUID_PATTERN.matches(id)) return@addWebMessageListener
            val reply = Reply(id, epoch.get(), proxy)
            val cancel = StrictExportJson.string(json, "method") == "cancel" &&
                StrictExportJson.integer(json, "v") == 1L &&
                json.keySet() == setOf("v", "requestId", "method")
            if (cancel) {
                val key = ExportRequestKey(reply.id, reply.generation)
                val current = active?.reply?.let { ExportRequestKey(it.id, it.generation) }
                if (key.mayCancel(current) && cancelQueued.compareAndSet(false, true)) {
                    val transfer = active
                    val accepted = transfer != null &&
                        key.mayCancel(ExportRequestKey(transfer.reply.id, transfer.reply.generation)) &&
                        transfer.termination.requestCancel()
                    if (!accepted) {
                        cancelQueued.set(false)
                        reply.send("error", "code" to "INVALID_CHUNK")
                        return@addWebMessageListener
                    }
                    execute {
                        try {
                            if (reply.generation == epoch.get() && transfer != null && !transfer.termination.isTerminal())
                                receive(json, reply)
                        } finally { cancelQueued.set(false) }
                    }
                } else if (!key.mayCancel(current)) reply.send("error", "code" to "INVALID_CHUNK")
            } else execute(reply) { if (reply.generation == epoch.get()) receive(json, reply) }
        }
        installed = true
    }

    fun attachBrowser(next: WebView) {
        if (browser === next) return
        invalidate()
        if (installed) { WebViewCompat.removeWebMessageListener(browser, CHANNEL); installed = false }
        host = null
        browser = next
    }

    fun invalidate() {
        // Admit cancellation before changing the page epoch, even if worker IO is in flight.
        active?.termination?.requestCancel()
        epoch.incrementAndGet()
        if (cleanupQueued.compareAndSet(false, true)) execute {
            try { active?.let { finish(it, "cancelled") } } finally { cleanupQueued.set(false) }
        }
    }

    fun destroy() {
        invalidate()
        destroyed = true
        host = null
        if (installed) { WebViewCompat.removeWebMessageListener(browser, CHANNEL); installed = false }
        worker.shutdown()
    }

    private fun execute(reply: Reply? = null, action: () -> Unit) {
        if (reply != null && incoming.incrementAndGet() > 1) {
            incoming.decrementAndGet()
            val key = ExportRequestKey(reply.id, reply.generation)
            val current = active?.reply?.let { ExportRequestKey(it.id, it.generation) }
            if (!key.mayCancel(current)) {
                reply.send("error", "code" to "BUSY")
                return
            }
            if (overflowAbortQueued.compareAndSet(false, true)) execute {
                try {
                    val transfer = active
                    val target = transfer?.reply?.let { ExportRequestKey(it.id, it.generation) }
                    if (transfer != null && key.mayCancel(target)) {
                        if (transfer.termination.cancelRequested) finish(transfer, "cancelled")
                        else finish(transfer, "error", "BUSY")
                    }
                } finally { overflowAbortQueued.set(false) }
            }
            return
        }
        try { worker.execute { try { action() } finally { if (reply != null) incoming.decrementAndGet() } } }
        catch (_: RejectedExecutionException) { if (reply != null) incoming.decrementAndGet() }
    }

    private fun receive(json: JsonObject, reply: Reply) {
        val method = StrictExportJson.string(json, "method")
        val fields = when (method) {
            "begin" -> setOf("v", "requestId", "method", "filename", "mime", "byteLength")
            "chunk" -> setOf("v", "requestId", "method", "seq", "base64")
            "commit", "cancel" -> setOf("v", "requestId", "method")
            else -> emptySet()
        }
        val validShape = StrictExportJson.integer(json, "v") == 1L && fields.isNotEmpty() && json.keySet() == fields
        if (!validShape) {
            val transfer = active
            if (transfer?.reply?.id == reply.id && method in setOf("chunk", "commit", "cancel"))
                finish(transfer, "error", "INVALID_CHUNK")
            else reply.send("error", "code" to "INVALID_METADATA")
            return
        }
        if (method == "begin") {
            val name = StrictExportJson.string(json, "filename")
            val mime = StrictExportJson.string(json, "mime")
            val length = StrictExportJson.integer(json, "byteLength")
            if (name == null || name.isEmpty() || name.length > 128 || name in setOf(".", "..") ||
                name.any { it == '/' || it == '\\' || it == '\u0000' } || mime == null || mime.length > 128 ||
                mime.any { it == '\r' || it == '\n' } || length == null || length !in 0..FileExportSession.MAX_FILE_BYTES.toLong()) {
                reply.send("error", "code" to "INVALID_METADATA"); return
            }
            if (active != null) { reply.send("error", "code" to "BUSY"); return }
            val transfer = Transfer(reply, name, mime.ifEmpty { "application/octet-stream" }, length.toInt())
            active = transfer
            activity.runOnUiThread {
                if (reply.generation != epoch.get() || destroyed) return@runOnUiThread
                if (picking != null) {
                    execute { finish(transfer, "error", "BUSY") }
                    return@runOnUiThread
                }
                picking = transfer
                try {
                    picker.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE); type = transfer.mime
                        putExtra(Intent.EXTRA_TITLE, transfer.filename)
                    })
                } catch (_: Exception) {
                    picking = null
                    execute { finish(transfer, "error", "WRITE_FAILED") }
                }
            }
            return
        }
        val transfer = active
        if (transfer == null || transfer.reply.id != reply.id || transfer.reply.generation != reply.generation) {
            reply.send("error", "code" to "INVALID_CHUNK"); return
        }
        if (method == "cancel") { finish(transfer, "cancelled"); return }
        val session = transfer.session
        if (session == null) { finish(transfer, "error", "INVALID_CHUNK"); return }
        try {
            if (method == "chunk") {
                val seq = StrictExportJson.integer(json, "seq")
                val bytes = StrictExportJson.string(json, "base64")
                if (seq == null || seq !in 0..Int.MAX_VALUE.toLong() || bytes == null) throw ExportFailure("INVALID_CHUNK")
                if (transfer.termination.cancelRequested) { finish(transfer, "cancelled"); return }
                session.chunk(seq.toInt(), bytes)
                if (transfer.termination.cancelRequested) { finish(transfer, "cancelled"); return }
                reply.send("ack", "nextSeq" to session.nextSeq, "bytesWritten" to session.bytesWritten)
            } else {
                if (transfer.termination.cancelRequested) { finish(transfer, "cancelled"); return }
                session.commit()
                val committed = transfer.termination.commit()
                if (!committed) { finish(transfer, "cancelled"); return }
                active = null
                reply.send("success", "bytesWritten" to session.bytesWritten)
            }
        } catch (failure: ExportFailure) {
            if (transfer.termination.cancelRequested) finish(transfer, "cancelled")
            else finish(transfer, "error", failure.code)
        }
    }

    private fun finish(transfer: Transfer, status: String, code: String? = null) {
        if (!transfer.termination.finish()) return
        transfer.session?.cancel()
        val partial = transfer.uri?.let { !delete(it) } ?: false
        if (active === transfer) active = null
        if (code == null) transfer.reply.send(status, "partialFileMayRemain" to partial)
        else transfer.reply.send(status, "code" to code, "partialFileMayRemain" to partial)
        if (partial) activity.runOnUiThread { notice("保存未完成；所选位置可能保留不完整文件。") }
    }

    private fun deleteOrNotice(uri: Uri) {
        if (!delete(uri)) activity.runOnUiThread { notice("上次保存已取消，但所选位置可能保留不完整文件。") }
    }

    private fun delete(uri: Uri): Boolean = runCatching {
        DocumentsContract.deleteDocument(activity.contentResolver, uri)
    }.getOrDefault(false)

    companion object {
        const val CHANNEL = "jarvisFileExport"
        const val MAX_MESSAGE_BYTES = 96 * 1024
        private val UUID_PATTERN = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
    }
}
