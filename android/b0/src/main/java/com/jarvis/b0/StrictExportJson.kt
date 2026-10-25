package com.jarvis.b0

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.Strictness
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import java.io.StringReader

internal object StrictExportJson {
    fun parse(raw: String): JsonObject? = runCatching {
        JsonReader(StringReader(raw)).use { reader ->
            reader.strictness = Strictness.STRICT
            val value = JsonParser.parseReader(reader)
            require(reader.peek() == JsonToken.END_DOCUMENT && value.isJsonObject)
            value.asJsonObject
        }
    }.getOrNull()

    fun string(json: JsonObject, key: String): String? = json.get(key)?.let {
        if (it.isJsonPrimitive && it.asJsonPrimitive.isString) it.asString else null
    }

    fun integer(json: JsonObject, key: String): Long? = json.get(key)?.let {
        if (!it.isJsonPrimitive || !it.asJsonPrimitive.isNumber) return@let null
        it.asString.takeIf { value -> Regex("-?(0|[1-9][0-9]*)").matches(value) }?.toLongOrNull()
    }
}
