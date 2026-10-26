package com.jarvis.b0

import android.content.Context
import com.google.gson.Gson

internal data class ScheduledNotifyState(
    val host: String? = null,
    val snapshot: ScheduledNotifySnapshot? = null,
    val alarms: List<ScheduledNotifyAlarm> = emptyList(),
    val failure: ScheduledNotifyFailure = ScheduledNotifyFailure(),
    val delivered: Set<String> = emptySet(),
    val dailyDelivered: Set<String> = emptySet(),
    val pendingDaily: Map<String, Long> = emptyMap(),
    val needsRestore: Boolean = false,
    val legacyImported: Boolean = false
)

/** Injectable persistence boundary lets JVM tests exercise actual serialization and failed writes. */
internal class ScheduledNotifyStore(private val readValue: () -> String?, private val writeValue: (String) -> Boolean,
    private val readEnabled: () -> Boolean = { true }, private val writeEnabled: (Boolean) -> Unit = {}) {
    constructor(context: Context) : this(
        { context.getSharedPreferences("dsh-mobile-schedule", 0).getString("state", null) },
        { context.getSharedPreferences("dsh-mobile-schedule", 0).edit().putString("state", it).commit() },
        { context.getSharedPreferences("dsh-mobile-schedule", 0).getBoolean("enabled", true) },
        { check(context.getSharedPreferences("dsh-mobile-schedule", 0).edit().putBoolean("enabled", it).commit()) }
    )
    fun enabled() = readEnabled()
    fun setEnabled(value: Boolean) = writeEnabled(value)
    fun read(): ScheduledNotifyState = runCatching {
        Gson().fromJson(readValue(), ScheduledNotifyState::class.java)?.also {
            requireNotNull(it.alarms); requireNotNull(it.delivered); requireNotNull(it.dailyDelivered)
            requireNotNull(it.pendingDaily); requireNotNull(it.failure)
        } ?: ScheduledNotifyState()
    }.getOrDefault(ScheduledNotifyState())
    fun write(state: ScheduledNotifyState) { check(writeValue(Gson().toJson(state))) { "Schedule state not saved" } }
}
