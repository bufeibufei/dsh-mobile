package com.jarvis.b0

import com.google.gson.*
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import java.io.StringReader
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** Strict JSON, including duplicate members, before any durable state mutation. */
internal object ScheduledNotifyWire {
    private val keyPattern = Regex("[a-z][a-z0-9-]{0,31}/[A-Za-z0-9._:-]{1,128}")
    private fun parse(raw: String): JsonObject {
        require(raw.length <= 1024 * 1024)
        JsonReader(StringReader(raw)).use { r ->
            r.strictness = Strictness.STRICT
            fun read(depth: Int): JsonElement {
                require(depth < 32)
                return when (r.peek()) {
                    JsonToken.BEGIN_OBJECT -> JsonObject().also { o ->
                        r.beginObject()
                        while (r.hasNext()) { val k = r.nextName(); require(!o.has(k)); o.add(k, read(depth + 1)) }
                        r.endObject()
                    }
                    JsonToken.BEGIN_ARRAY -> JsonArray().also { a ->
                        r.beginArray(); while (r.hasNext()) a.add(read(depth + 1)); r.endArray()
                    }
                    JsonToken.STRING -> JsonPrimitive(r.nextString())
                    JsonToken.BOOLEAN -> JsonPrimitive(r.nextBoolean())
                    JsonToken.NULL -> { r.nextNull(); JsonNull.INSTANCE }
                    JsonToken.NUMBER -> JsonPrimitive(r.nextString().toBigDecimal())
                    else -> error("Invalid JSON")
                }
            }
            val value = read(0).asJsonObject
            require(r.peek() == JsonToken.END_DOCUMENT)
            return value
        }
    }
    private fun fields(value: JsonObject, vararg names: String) { require(value.keySet() == names.toSet()) }
    fun value(raw: String): JsonObject {
        val envelope = parse(raw); fields(envelope, "ok", "value"); require(bool(envelope, "ok"))
        return envelope.getAsJsonObject("value")
    }
    fun string(value: JsonObject, key: String): String = requireNotNull(StrictExportJson.string(value, key))
    private fun key(value: JsonObject): String = string(value, "key").also { require(keyPattern.matches(it)) }
    private fun open(value: JsonObject): String? {
        val item = requireNotNull(value.get("open"))
        return if (item.isJsonNull) null else string(value, "open").also { require(it.codePointCount(0, it.length) <= 256) }
    }
    fun bool(value: JsonObject, key: String): Boolean {
        val item = requireNotNull(value.get(key)); require(item.isJsonPrimitive && item.asJsonPrimitive.isBoolean)
        return item.asBoolean
    }
    fun snapshot(raw: String): ScheduledNotifySnapshot {
        val v = value(raw); fields(v, "version", "items", "daily")
        val version = string(v, "version"); require(Regex("[0-9a-f]{64}").matches(version))
        val items = v.getAsJsonArray("items").map { element ->
            val i = element.asJsonObject; fields(i, "key", "at", "title", "text", "open", "actions", "snooze")
            val at = string(i, "at")
            require(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,9})?Z").matches(at))
            Instant.parse(at)
            val actions = i.getAsJsonArray("actions").map { a ->
                val o = a.asJsonObject; fields(o, "id", "label")
                ScheduledNotifyAction(string(o, "id"), string(o, "label")).also {
                    require(Regex("[a-z][a-z0-9-]{0,15}").matches(it.id))
                    require(it.label.codePointCount(0, it.label.length) in 1..8)
                }
            }
            require(actions.size <= 2 && actions.map { it.id }.distinct().size == actions.size)
            ScheduledNotifyItem(key(i), at, string(i, "title"), string(i, "text"), open(i), actions, bool(i, "snooze"))
        }
        val daily = v.getAsJsonArray("daily").map { element ->
            val d = element.asJsonObject; fields(d, "key", "time", "timezone")
            val time = string(d, "time"); require(Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]").matches(time)); LocalTime.parse(time)
            val zone = string(d, "timezone"); ZoneId.of(zone)
            ScheduledNotifyDaily(key(d), time, zone)
        }
        val keys = items.map { it.key } + daily.map { it.key }; require(keys.distinct().size == keys.size)
        return ScheduledNotifySnapshot(version, items, daily)
    }
    fun content(raw: String): ScheduledNotifyContent {
        val v = value(raw); fields(v, "key", "date", "shouldNotify", "title", "text", "open")
        val date = string(v, "date"); require(LocalDate.parse(date).toString() == date)
        return ScheduledNotifyContent(key(v), date, bool(v, "shouldNotify"), string(v, "title"), string(v, "text"), open(v))
    }
    fun action(raw: String, key: String, action: String) {
        val v = value(raw); fields(v, "key", "action", "status")
        require(string(v, "key") == key && string(v, "action") == action && string(v, "status") == "done")
    }
}
