package com.jarvis.b0

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorSpace
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Blocking Android IO/codec glue. All methods are called on the chooser's worker. */
internal class ImagePreparer(context: Context) {
    private val context = context.applicationContext
    private val resolver = this.context.contentResolver
    private val directory = File(this.context.cacheDir, "b0-images")
    data class Capture(val file: File, val uri: Uri)
    data class Prepared(val uris: List<Uri>, val skipped: Int)

    fun cleanup(nowMs: Long) {
        directory.listFiles()?.forEach { file ->
            if (file.isFile && ImagePreparationPolicy.isExpired(file.lastModified(), nowMs)) file.delete()
        }
    }

    fun createCapture(): Capture {
        ensureDirectory()
        val file = File.createTempFile("CAPTURE_", ".jpg", directory)
        return Capture(file, uri(file))
    }

    fun prepare(inputs: List<Uri>, cancelled: () -> Boolean): Prepared {
        val outputs = mutableListOf<Uri>()
        var skipped = 0
        for (input in inputs) {
            if (cancelled()) break
            try {
                outputs += prepareOne(input)
            } catch (_: Exception) {
                skipped++
            } catch (_: OutOfMemoryError) {
                // A malformed image or device codec may still exceed its allocation budget.
                skipped++
            }
        }
        return Prepared(outputs, skipped)
    }

    private fun prepareOne(input: Uri): Uri {
        val mime = resolver.getType(input)
        if (ImagePreparationPolicy.outputFormat(mime, false) == ImagePreparationPolicy.Format.PASSTHROUGH) return input
        val bitmap = decode(input)
        try {
            val format = ImagePreparationPolicy.outputFormat(mime, hasTransparentPixels(bitmap))
            val png = format == ImagePreparationPolicy.Format.PNG
            val output = newOutput(if (png) "png" else "jpg")
            try {
                output.outputStream().use { stream ->
                    check(bitmap.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG,
                        ImagePreparationPolicy.JPEG_QUALITY, stream)) { "Image encoding failed" }
                }
                return uri(output)
            } catch (failure: Throwable) {
                // Never returned to WebView: an incomplete output can be discarded safely.
                output.delete()
                throw failure
            }
        } finally {
            bitmap.recycle()
        }
    }

    private fun decode(input: Uri): Bitmap {
        var bitmap = if (Build.VERSION.SDK_INT >= 28) decodeModern(input) else decodeLegacy(input)
        try {
            val size = ImagePreparationPolicy.targetSize(bitmap.width, bitmap.height)
            if (size.width != bitmap.width || size.height != bitmap.height) {
                val scaled = Bitmap.createScaledBitmap(bitmap, size.width, size.height, true)
                if (scaled !== bitmap) { bitmap.recycle(); bitmap = scaled }
            }
            val srgb = ColorSpace.get(ColorSpace.Named.SRGB)
            // A fresh pixel-only bitmap also drops any decoder-attached HDR gainmap/metadata.
            val converted = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888,
                bitmap.hasAlpha(), srgb)
            try { Canvas(converted).drawBitmap(bitmap, 0f, 0f, null) }
            catch (failure: Throwable) { converted.recycle(); throw failure }
            bitmap.recycle()
            bitmap = converted
            return bitmap
        } catch (failure: Throwable) {
            bitmap.recycle()
            throw failure
        }
    }

    @RequiresApi(28)
    private fun decodeModern(input: Uri): Bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, input)) {
            decoder, info, _ ->
        val size = ImagePreparationPolicy.targetSize(info.size.width, info.size.height)
        decoder.setTargetSize(size.width, size.height)
        decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        // ImageDecoder applies EXIF orientation; its default rejects incomplete images.
    }

    private fun decodeLegacy(input: Uri): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        (resolver.openInputStream(input) ?: throw IOException("Cannot open image")).use {
            BitmapFactory.decodeStream(it, null, bounds)
        }
        val target = ImagePreparationPolicy.targetSize(bounds.outWidth, bounds.outHeight)
        var sample = 1
        while (bounds.outWidth / (sample * 2L) >= target.width && bounds.outHeight / (sample * 2L) >= target.height) {
            sample *= 2
        }
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
            inPreferredColorSpace = ColorSpace.get(ColorSpace.Named.SRGB)
        }
        // API 26–27 deliberately skips EXIF rotation (see README).
        return resolver.openInputStream(input)?.use { BitmapFactory.decodeStream(it, null, options) }
            ?: throw IOException("Cannot decode image")
    }

    private fun hasTransparentPixels(bitmap: Bitmap): Boolean {
        if (!bitmap.hasAlpha()) return false
        val pixels = IntArray(minOf(bitmap.width, 1024))
        for (y in 0 until bitmap.height) {
            var x = 0
            while (x < bitmap.width) {
                val count = minOf(pixels.size, bitmap.width - x)
                bitmap.getPixels(pixels, 0, count, x, y, count, 1)
                for (i in 0 until count) if (pixels[i] ushr 24 != 255) return true
                x += count
            }
        }
        return false
    }

    private fun ensureDirectory() { check(directory.isDirectory || directory.mkdirs()) { "Cannot create image cache" } }
    private fun uri(file: File): Uri = FileProvider.getUriForFile(context, "${context.packageName}.images", file)

    private fun newOutput(extension: String): File {
        ensureDirectory()
        val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        var sequence = 1
        while (true) {
            val file = File(directory, "IMG_${timestamp}_${sequence++}.$extension")
            if (file.createNewFile()) return file
        }
    }
}
