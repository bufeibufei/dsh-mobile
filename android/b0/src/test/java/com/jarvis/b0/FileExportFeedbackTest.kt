package com.jarvis.b0

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FileExportFeedbackTest {
    @Test fun terminalResultsStayDistinct() {
        assertEquals("已保存到所选位置", FileExportFeedback.message("success", false))
        assertEquals("已取消保存", FileExportFeedback.message("cancelled", false))
        assertEquals("保存失败", FileExportFeedback.message("error", false))
        assertEquals("已取消保存；所选位置可能保留不完整文件。", FileExportFeedback.message("cancelled", true))
        assertEquals("保存未完成；所选位置可能保留不完整文件。", FileExportFeedback.message("error", true))
        assertEquals("保存未完成；所选位置可能保留不完整文件。", FileExportFeedback.message("success", true))
        assertNull(FileExportFeedback.message("ready", false))
        assertNull(FileExportFeedback.message("ack", false))
        assertNull(FileExportFeedback.message("ack", true))
    }
}
