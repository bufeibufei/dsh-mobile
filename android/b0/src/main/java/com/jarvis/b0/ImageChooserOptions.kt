package com.jarvis.b0

/** No Android types: mode 1 is WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE. */
object ImageChooserOptions {
    const val MODE_OPEN_MULTIPLE = 1
    const val GALLERY_MAX = 9
    enum class Item(val label: String) { CAMERA("拍照"), GALLERY("从相册选择"), FILE("选择文件") }
    data class Options(val showSheet: Boolean, val galleryLimit: Int, val items: List<Item>)

    fun decide(acceptTypes: List<String>, mode: Int, cameraAvailable: Boolean): Options {
        val types = acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        val showSheet = types.isEmpty() || types.any { it == "*/*" || it.startsWith("image/") }
        val items = if (!showSheet) listOf(Item.FILE) else buildList {
            if (cameraAvailable) add(Item.CAMERA)
            add(Item.GALLERY)
            add(Item.FILE)
        }
        return Options(showSheet, if (mode == MODE_OPEN_MULTIPLE) GALLERY_MAX else 1, items)
    }
}
