package com.jarvis.b0

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.webkit.WebChromeClient
import androidx.activity.ComponentActivity
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import java.util.concurrent.Executors

/** Native UI/result plumbing; B0Activity supplies the current callback/browser/connection gate. */
internal class ImageChooserController(
    private val activity: ComponentActivity,
    private val notice: (String) -> Unit,
    private val processing: (Boolean) -> Unit,
) {
    private class Request(
        val params: WebChromeClient.FileChooserParams,
        val options: ImageChooserOptions.Options,
        val isCurrent: () -> Boolean,
        val deliver: (Array<Uri>?) -> Unit,
    ) {
        @Volatile var cancelled = false
        var capture: ImagePreparer.Capture? = null
        var indicator: Runnable? = null
    }

    private val handler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val preparer by lazy { ImagePreparer(activity) }
    private var active: Request? = null
    private var dialog: AlertDialog? = null
    // Keep the launch ticket even after invalidation: an old result must never claim a new callback.
    private var external: Request? = null
    private var destroyed = false

    private val file = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        takeExternal()?.let { finish(it, WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)) }
    }
    private val single = activity.registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        takeExternal()?.let { prepare(it, listOfNotNull(uri)) }
    }
    private val multiple = activity.registerForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(9)) { uris ->
        takeExternal()?.let { prepare(it, uris) }
    }
    private val galleryFallback = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        takeExternal()?.let { request ->
            val uris = if (result.resultCode == Activity.RESULT_OK) buildList {
                result.data?.data?.let { add(it) }
                result.data?.clipData?.let { clip -> repeat(clip.itemCount) { add(clip.getItemAt(it).uri) } }
            } else emptyList()
            prepare(request, uris)
        }
    }
    private val camera = activity.registerForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        takeExternal()?.let { request ->
            val capture = request.capture
            if (!saved || capture == null) finish(request, null)
            else {
                // Empty-file check and all subsequent image IO stay off the main thread.
                worker.execute {
                    val inputs = if (capture.file.length() > 0L) listOf(capture.uri) else emptyList()
                    handler.post { if (current(request)) prepare(request, inputs) }
                }
            }
        }
    }

    fun cleanup() {
        val now = System.currentTimeMillis()
        worker.execute { runCatching { preparer.cleanup(now) } }
    }

    fun open(params: WebChromeClient.FileChooserParams, isCurrent: () -> Boolean, deliver: (Array<Uri>?) -> Unit) {
        invalidate()
        val cameraAvailable = Intent(MediaStore.ACTION_IMAGE_CAPTURE).resolveActivity(activity.packageManager) != null
        val options = ImageChooserOptions.decide(params.acceptTypes?.toList().orEmpty(), params.mode, cameraAvailable)
        val request = Request(params, options, isCurrent, deliver)
        active = request
        if (!options.showSheet) { launchFile(request); return }
        cleanup()
        val sheet = AlertDialog.Builder(activity)
            .setTitle("添加图片或文件")
            .setItems(options.items.map { it.label }.toTypedArray()) { _, which ->
                if (current(request)) when (options.items[which]) {
                    ImageChooserOptions.Item.CAMERA -> launchCamera(request)
                    ImageChooserOptions.Item.GALLERY -> launchGallery(request)
                    ImageChooserOptions.Item.FILE -> launchFile(request)
                }
            }
            .setNegativeButton("取消") { _, _ -> finish(request, null) }
            .create()
        sheet.setOnCancelListener { finish(request, null) }
        sheet.setOnDismissListener { if (dialog === sheet) dialog = null }
        // AlertDialog owns Back/outside-touch cancellation, before the Activity's WebView Back handler.
        sheet.setCanceledOnTouchOutside(true)
        dialog = sheet
        sheet.show()
    }

    fun invalidate() {
        val request = active
        active = null
        dialog?.dismiss(); dialog = null
        if (request != null) {
            stopProcessing(request)
            request.cancelled = true
            request.deliver(null)
        }
    }

    fun destroy() {
        invalidate()
        destroyed = true
        external = null
        worker.shutdownNow()
    }

    private fun current(request: Request): Boolean = !destroyed && !request.cancelled &&
        active === request && request.isCurrent()

    private fun takeExternal(): Request? {
        val request = external
        external = null
        return request?.takeIf { current(it) }
    }

    private fun launch(request: Request, action: () -> Unit) {
        if (!current(request)) return
        if (external != null) {
            notice("请先完成已打开的选择器。")
            finish(request, null)
            return
        }
        external = request
        try { action() }
        catch (_: Exception) {
            external = null
            notice("没有可用的文件选择器。")
            finish(request, null)
        }
    }

    private fun launchFile(request: Request) = launch(request) { file.launch(request.params.createIntent()) }

    private fun launchGallery(request: Request) = launch(request) {
        val multi = request.options.galleryLimit > 1
        if (ActivityResultContracts.PickVisualMedia.isPhotoPickerAvailable(activity)) {
            val input = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
            if (multi) multiple.launch(input) else single.launch(input)
        } else {
            galleryFallback.launch(Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "image/*"
                addCategory(Intent.CATEGORY_OPENABLE)
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multi)
            })
        }
    }

    private fun launchCamera(request: Request) {
        worker.execute {
            val capture = runCatching { preparer.createCapture() }.getOrNull()
            handler.post {
                if (!current(request)) return@post
                if (capture == null) {
                    notice("无法创建拍照文件。")
                    finish(request, null)
                } else {
                    request.capture = capture
                    launch(request) { camera.launch(capture.uri) }
                }
            }
        }
    }

    private fun prepare(request: Request, inputs: List<Uri>) {
        if (!current(request)) return
        // Some GET_CONTENT/OEM pickers ignore the requested maximum. Enforce it on receipt too.
        val selected = inputs.distinct().take(request.options.galleryLimit)
        if (selected.isEmpty()) { finish(request, null); return }
        val indicator = Runnable { if (current(request)) processing(true) }
        request.indicator = indicator
        handler.postDelayed(indicator, 300)
        worker.execute {
            val prepared = preparer.prepare(selected) { request.cancelled }
            handler.post {
                if (!current(request)) return@post
                stopProcessing(request)
                ImagePreparationPolicy.skipNotice(prepared.skipped)?.let(notice)
                finish(request, prepared.uris.takeIf { it.isNotEmpty() }?.toTypedArray())
            }
        }
    }

    private fun stopProcessing(request: Request) {
        request.indicator?.let { handler.removeCallbacks(it) }
        request.indicator = null
        processing(false)
    }

    private fun finish(request: Request, uris: Array<Uri>?) {
        if (!current(request)) return
        active = null
        stopProcessing(request)
        request.cancelled = true
        request.deliver(uris)
    }
}
