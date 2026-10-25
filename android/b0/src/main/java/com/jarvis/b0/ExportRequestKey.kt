package com.jarvis.b0

/** Request correlation is part of file authority; an unrelated busy sender cannot cancel it. */
internal data class ExportRequestKey(val id: String, val generation: Long) {
    fun mayCancel(active: ExportRequestKey?): Boolean = this == active
}
