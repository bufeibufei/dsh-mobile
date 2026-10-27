package com.jarvis.b0

import kotlin.math.sqrt

/** Platform-independent rules shared by the decoder and JVM tests. */
object ImagePreparationPolicy {
    const val MAX_PIXELS = 2048L * 2048L
    const val JPEG_QUALITY = 85
    const val TEMP_LIFETIME_MS = 24L * 60L * 60L * 1000L

    data class Size(val width: Int, val height: Int)
    enum class Format { JPEG, PNG, PASSTHROUGH }

    fun targetSize(width: Int, height: Int): Size {
        require(width > 0 && height > 0)
        val pixels = width.toLong() * height
        if (pixels <= MAX_PIXELS) return Size(width, height)
        val factor = sqrt(MAX_PIXELS.toDouble() / pixels)
        var w = (width * factor).toInt().coerceAtLeast(1)
        var h = (height * factor).toInt().coerceAtLeast(1)
        // Rounding a very thin image up to one pixel must not exceed the area cap.
        if (w.toLong() * h > MAX_PIXELS) {
            if (w > h) w = (MAX_PIXELS / h).toInt() else h = (MAX_PIXELS / w).toInt()
        }
        return Size(w, h)
    }

    /** hasAlpha means actual non-opaque pixels, not merely an alpha-capable bitmap. */
    fun outputFormat(mime: String?, hasAlpha: Boolean): Format = when (mime?.trim()?.lowercase()) {
        "image/gif" -> Format.PASSTHROUGH
        "image/png" -> if (hasAlpha) Format.PNG else Format.JPEG
        else -> Format.JPEG
    }

    fun skipNotice(skipped: Int): String? = if (skipped > 0) "有 ${skipped} 张图片无法读取，已跳过" else null

    fun isExpired(lastModifiedMs: Long, nowMs: Long): Boolean =
        nowMs >= TEMP_LIFETIME_MS && lastModifiedMs < nowMs - TEMP_LIFETIME_MS
}
