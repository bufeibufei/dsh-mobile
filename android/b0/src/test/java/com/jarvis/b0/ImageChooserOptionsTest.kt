package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test

class ImageChooserOptionsTest {
    @Test fun emptyAcceptTypesShowAllOptions() {
        val options = ImageChooserOptions.decide(emptyList(), 0, true)
        assertTrue(options.showSheet)
        assertEquals(listOf(ImageChooserOptions.Item.CAMERA, ImageChooserOptions.Item.GALLERY, ImageChooserOptions.Item.FILE), options.items)
    }

    @Test fun blankAcceptTypesShowSheet() {
        assertTrue(ImageChooserOptions.decide(listOf("", "  "), 0, true).showSheet)
    }

    @Test fun wildcardAllowsSheet() {
        assertTrue(ImageChooserOptions.decide(listOf("*/*"), 0, true).showSheet)
    }

    @Test fun anyImageTypeAllowsSheet() {
        listOf("image/*", "image/jpeg", "image/png", "image/heic", " IMAGE/WEBP ").forEach {
            assertTrue(it, ImageChooserOptions.decide(listOf(it), 0, true).showSheet)
        }
    }

    @Test fun mixedImagesAndOtherFilesAllowSheet() {
        assertTrue(ImageChooserOptions.decide(listOf("application/pdf", "image/png"), 0, true).showSheet)
        assertTrue(ImageChooserOptions.decide(listOf("application/pdf,image/png"), 0, true).showSheet)
        assertTrue(ImageChooserOptions.decide(listOf("application/pdf", "*/*"), 0, true).showSheet)
    }

    @Test fun onlyNonImagesGoDirectlyToFile() {
        val options = ImageChooserOptions.decide(listOf("application/pdf", "text/*", "video/*", ""), 1, true)
        assertFalse(options.showSheet)
        assertEquals(listOf(ImageChooserOptions.Item.FILE), options.items)
    }

    @Test fun missingCameraHidesOnlyCapture() {
        val options = ImageChooserOptions.decide(listOf("image/*"), 1, false)
        assertTrue(options.showSheet)
        assertEquals(listOf(ImageChooserOptions.Item.GALLERY, ImageChooserOptions.Item.FILE), options.items)
    }

    @Test fun multipleModeLimitsGalleryToNine() {
        assertEquals(9, ImageChooserOptions.decide(emptyList(), 1, true).galleryLimit)
    }

    @Test fun allOtherModesAreSingleSelect() {
        listOf(0, 2, 3, -1).forEach {
            assertEquals(1, ImageChooserOptions.decide(emptyList(), it, true).galleryLimit)
        }
    }

    @Test fun sheetUsesRequestedLabels() {
        assertEquals(listOf("拍照", "从相册选择", "选择文件"),
            ImageChooserOptions.decide(emptyList(), 0, true).items.map { it.label })
    }
}
