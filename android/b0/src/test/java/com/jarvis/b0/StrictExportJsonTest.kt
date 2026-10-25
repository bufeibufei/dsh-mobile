package com.jarvis.b0

import org.junit.Assert.*
import org.junit.Test

class StrictExportJsonTest {
    @Test fun rejectsNonJsonAndTrailingInput() {
        listOf("{\"v\":01}", "{\"byteLength\":07}", "{'v':1}", "{v:1}",
            "{\"v\":1} trailing", "{\"v\":1}{}", "{/*comment*/\"v\":1}", "[]")
            .forEach { assertNull(it, StrictExportJson.parse(it)) }
    }

    @Test fun acceptsStrictObjectWithWhitespaceAndUnicode() {
        val json = StrictExportJson.parse(" \n{\"v\":1,\"byteLength\":7,\"filename\":\"你好.txt\"}\n ")!!
        assertEquals(1L, StrictExportJson.integer(json, "v"))
        assertEquals(7L, StrictExportJson.integer(json, "byteLength"))
        assertEquals("你好.txt", StrictExportJson.string(json, "filename"))
    }

    @Test fun doesNotCoerceIntegerOrStringTypes() {
        listOf("\"1\"", "true", "null", "1.0", "1e0", "9223372036854775808")
            .forEach { assertNull(it, StrictExportJson.integer(StrictExportJson.parse("{\"v\":$it}")!!, "v")) }
        assertNull(StrictExportJson.string(StrictExportJson.parse("{\"filename\":7}")!!, "filename"))
    }
}
