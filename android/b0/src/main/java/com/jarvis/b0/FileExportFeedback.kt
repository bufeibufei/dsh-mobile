package com.jarvis.b0

/** A path-free summary of a terminal file export result for native settings. */
internal object FileExportFeedback {
    fun message(status: String, partialFileMayRemain: Boolean): String? {
        if (status !in setOf("success", "cancelled", "error")) return null
        return when {
            partialFileMayRemain && status == "cancelled" -> "已取消保存；所选位置可能保留不完整文件。"
            partialFileMayRemain -> "保存未完成；所选位置可能保留不完整文件。"
            status == "success" -> "已保存到所选位置"
            status == "cancelled" -> "已取消保存"
            else -> "保存失败"
        }
    }
}
