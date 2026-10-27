package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test

class ImagePreparationPolicyTest {
    @Test fun landscapeUsesAreaRatherThanLongestEdge() {
        assertEquals(ImagePreparationPolicy.Size(2364, 1773), ImagePreparationPolicy.targetSize(4000, 3000))
    }

    @Test fun portraitKeepsAspectRatio() {
        assertEquals(ImagePreparationPolicy.Size(1773, 2364), ImagePreparationPolicy.targetSize(3000, 4000))
    }

    @Test fun longScreenshotIsUnchanged() {
        assertEquals(ImagePreparationPolicy.Size(1080, 2400), ImagePreparationPolicy.targetSize(1080, 2400))
    }

    @Test fun exactLimitIsUnchanged() {
        assertEquals(ImagePreparationPolicy.Size(2048, 2048), ImagePreparationPolicy.targetSize(2048, 2048))
    }

    @Test fun tinyImageIsNotUpscaled() {
        assertEquals(ImagePreparationPolicy.Size(16, 9), ImagePreparationPolicy.targetSize(16, 9))
        assertEquals(ImagePreparationPolicy.Size(1, 1), ImagePreparationPolicy.targetSize(1, 1))
    }

    @Test fun hugeImageHasSameAreaBound() {
        assertEquals(ImagePreparationPolicy.Size(2364, 1773), ImagePreparationPolicy.targetSize(8000, 6000))
    }

    @Test fun squareAboveCapScalesDown() {
        assertEquals(ImagePreparationPolicy.Size(2048, 2048), ImagePreparationPolicy.targetSize(2049, 2049))
    }

    @Test fun dimensionsCannotOverflowPixelMultiplication() {
        assertEquals(ImagePreparationPolicy.Size(2048, 2048), ImagePreparationPolicy.targetSize(Int.MAX_VALUE, Int.MAX_VALUE))
    }

    @Test fun extremelyThinImageStillHonorsAreaLimit() {
        assertEquals(ImagePreparationPolicy.Size(4194304, 1), ImagePreparationPolicy.targetSize(Int.MAX_VALUE, 1))
        assertEquals(ImagePreparationPolicy.Size(1, 4194304), ImagePreparationPolicy.targetSize(1, Int.MAX_VALUE))
    }

    @Test fun sizeMatrixNeverUpscalesOrExceedsAreaAndPreservesRatioWithinRounding() {
        for (width in listOf(100, 1080, 2048, 4000, 8000, 16000)) {
            for (height in listOf(100, 1080, 2048, 3000, 6000, 16000)) {
                val size = ImagePreparationPolicy.targetSize(width, height)
                assertTrue(size.width in 1..width)
                assertTrue(size.height in 1..height)
                assertTrue(size.width.toLong() * size.height <= ImagePreparationPolicy.MAX_PIXELS)
                assertTrue(kotlin.math.abs(size.width.toDouble() / width - size.height.toDouble() / height) <=
                    1.0 / minOf(width, height))
            }
        }
    }

    @Test(expected = IllegalArgumentException::class) fun zeroWidthIsRejected() {
        ImagePreparationPolicy.targetSize(0, 100)
    }

    @Test(expected = IllegalArgumentException::class) fun negativeHeightIsRejected() {
        ImagePreparationPolicy.targetSize(100, -1)
    }

    @Test fun gifPassesThroughRegardlessOfAlpha() {
        listOf(false, true).forEach {
            assertEquals(ImagePreparationPolicy.Format.PASSTHROUGH, ImagePreparationPolicy.outputFormat("image/gif", it))
        }
    }

    @Test fun transparentPngRemainsPng() {
        assertEquals(ImagePreparationPolicy.Format.PNG, ImagePreparationPolicy.outputFormat("image/png", true))
    }

    @Test fun opaquePngBecomesJpeg() {
        assertEquals(ImagePreparationPolicy.Format.JPEG, ImagePreparationPolicy.outputFormat("image/png", false))
    }

    @Test fun otherDecodableFormatsBecomeJpegEvenWithAlpha() {
        listOf("image/jpeg", "image/heic", "image/heif", "image/webp", null, "application/octet-stream").forEach { mime ->
            listOf(false, true).forEach { alpha ->
                assertEquals(ImagePreparationPolicy.Format.JPEG, ImagePreparationPolicy.outputFormat(mime, alpha))
            }
        }
    }

    @Test fun mimeMatchingIsCaseInsensitive() {
        assertEquals(ImagePreparationPolicy.Format.PNG, ImagePreparationPolicy.outputFormat(" IMAGE/PNG ", true))
    }

    @Test fun noticeAbsentWhenNothingSkipped() {
        assertNull(ImagePreparationPolicy.skipNotice(0))
    }

    @Test fun noticeReportsExactSkippedCount() {
        assertEquals("有 1 张图片无法读取，已跳过", ImagePreparationPolicy.skipNotice(1))
        assertEquals("有 9 张图片无法读取，已跳过", ImagePreparationPolicy.skipNotice(9))
    }

    private val now = 3 * ImagePreparationPolicy.TEMP_LIFETIME_MS

    @Test fun olderThan24HoursExpires() {
        assertTrue(ImagePreparationPolicy.isExpired(now - ImagePreparationPolicy.TEMP_LIFETIME_MS - 1, now))
    }

    @Test fun exactly24HoursIsRetained() {
        assertFalse(ImagePreparationPolicy.isExpired(now - ImagePreparationPolicy.TEMP_LIFETIME_MS, now))
    }

    @Test fun recentAndJustCreatedFilesAreRetained() {
        assertFalse(ImagePreparationPolicy.isExpired(now - 1, now))
        assertFalse(ImagePreparationPolicy.isExpired(now, now))
    }

    @Test fun futureTimestampIsRetainedAfterClockMovesBack() {
        assertFalse(ImagePreparationPolicy.isExpired(now + 1, now))
        assertFalse(ImagePreparationPolicy.isExpired(now, 0))
    }
}
