package com.jarvis.b0

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.google.gson.JsonParser
import java.time.Instant
import java.time.LocalDate

/** Exists only for upgrades from older builds. All knowledge of the legacy business store stays here. */
internal object LegacyReminderImport {
    data class Import(val state: ScheduledNotifyState, val alarmKeys: List<String>)
    fun decode(raw: String?, current: ScheduledNotifyState, now: Long): Import = runCatching {
        decodeValid(raw, current, now)
    }.getOrElse { Import(current.copy(legacyImported = true), emptyList()) }
    private fun decodeValid(raw: String?, current: ScheduledNotifyState, now: Long): Import {
        if (raw == null) return Import(current.copy(legacyImported = true), emptyList())
        val old = JsonParser.parseString(raw).asJsonObject
        val host = old.get("host")?.takeUnless { it.isJsonNull }?.asString
        val alarms = old.getAsJsonArray("alarms")?.toList().orEmpty()
        val keys = alarms.map { it.asJsonObject.getAsJsonObject("reminder").get("key").asString }
        if (current.legacyImported || current.host != null && current.host != host)
            return Import(current.copy(legacyImported = true), keys)
        val delivered = current.delivered.toMutableSet()
        val imported = mutableListOf<ScheduledNotifyAlarm>()
        alarms.forEach { element ->
            val alarm = element.asJsonObject
            val r = alarm.getAsJsonObject("reminder")
            val key = "life/" + r.get("key").asString
            val at = alarm.get("at").asLong
            val original = r.get("remindAt").asString
            if (alarm.get("delivered")?.asBoolean == true) delivered.add(key)
            else if (at > now && at != Instant.parse(original).toEpochMilli()) {
                // Only pending snoozes are imported; the provider supplies ordinary future entries.
                fun nullable(name: String) = r.get(name)?.takeUnless { it.isJsonNull }?.asString
                val text = listOfNotNull(nullable("plannedTime") ?: nullable("plannedDate"), nullable("place"))
                    .filter { it.isNotBlank() }.joinToString(" · ")
                val item = ScheduledNotifyItem(key, original, r.get("title").asString, text,
                    nullable("planId")?.let { "plan:$it" }, listOf(ScheduledNotifyAction("complete", "完成")), true)
                delivered.add(key)
                imported.add(ScheduledNotifyAlarm(item, at))
            }
        }
        val dates = current.dailyDelivered.toMutableSet()
        old.get("lastBriefDate")?.takeUnless { it.isJsonNull }?.asString?.let {
            LocalDate.parse(it); dates.add(ScheduledNotifyGate.dailyToken("life/brief", it))
        }
        return Import(current.copy(host = current.host ?: host, delivered = delivered, dailyDelivered = dates,
            alarms = (current.alarms + imported).distinctBy { it.item.key }, legacyImported = true), keys)
    }
    fun run(context: Context, store: ScheduledNotifyStore): ScheduledNotifyState {
        val prefs = context.getSharedPreferences("b0-reminders", Context.MODE_PRIVATE)
        val current = store.read()
        val raw = prefs.getString("state", null)
        val jobs = context.getSystemService(JobScheduler::class.java)
        listOf(4101, 4102, 4103).forEach(jobs::cancel)
        if (current.legacyImported && raw == null) return current
        // Commit before removing the old file. A restart between these steps only repeats cleanup.
        val result = decode(raw, current, System.currentTimeMillis())
        store.write(result.state)
        if (!prefs.getBoolean("enabled", true)) store.setEnabled(false)
        val oldHost = runCatching { raw?.let { JsonParser.parseString(it).asJsonObject.get("host") }
            ?.takeUnless { it.isJsonNull }?.asString }.getOrNull()
        if (oldHost != null) {
            val manager = context.getSystemService(AlarmManager::class.java)
            (result.alarmKeys + "@daily-brief").forEach { key ->
                val intent = Intent().apply {
                    component = ComponentName(context.packageName, "com.jarvis.b0.ReminderReceiver")
                    action = "com.jarvis.b0.REMINDER_ALARM"
                    data = Uri.Builder().scheme("jarvis-reminder").authority("local").appendPath(oldHost).appendPath(key).build()
                }
                PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.let {
                    manager.cancel(it); it.cancel()
                }
            }
        }
        check(context.deleteSharedPreferences("b0-reminders"))
        return result.state
    }
}
