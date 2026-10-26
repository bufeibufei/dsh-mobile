package com.jarvis.b0

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import com.google.gson.JsonObject
import java.time.Instant
import java.util.concurrent.PriorityBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicBoolean

/** Serializes disk/alarm mutations. Host epochs invalidate late HTTP results on switch/logout. */
internal class ScheduledNotifySync private constructor(context: Context) {
    private val app = context.applicationContext
    private val store = ScheduledNotifyStore(app)
    private val scheduler = ScheduledNotifyScheduler(app)
    private val notifications = ScheduledNotifyNotifications(app)
    private val cookies = CookieManager.getInstance()
    private class Task(val priority: Int, val order: Long, val action: () -> Unit) : Runnable, Comparable<Task> {
        override fun run() = action()
        override fun compareTo(other: Task): Int = compareValuesBy(this, other, Task::priority, Task::order)
    }
    private val worker = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, PriorityBlockingQueue())
    private val sequence = AtomicLong()
    private val changeQueued = AtomicBoolean()
    private val changeSerial = AtomicLong()
    private var restoredHost: String? = null
    private var restoredExact: Boolean? = null
    private val main = Handler(Looper.getMainLooper())
    private var state = LegacyReminderImport.run(app, store)
    @Volatile private var host = state.host.takeIf { store.enabled() }
    @Volatile private var epoch = 0L
    private fun now() = System.currentTimeMillis()
    private fun current(target: String, ticket: Long): Boolean = host == target && epoch == ticket
    private fun save(next: ScheduledNotifyState) { store.write(next); state = next }

    fun prepareHost(address: HostAddress) {
        if (host != null && host != address.base.toASCIIString()) deactivate()
    }

    fun activate(address: HostAddress, callback: (ScheduledNotifySnapshot?) -> Unit) {
        val target = address.base.toASCIIString()
        store.setEnabled(true)
        if (host != target) { epoch++; host = target }
        val ticket = epoch
        execute {
            if (!current(target, ticket)) return@execute
            if (state.host != target) {
                scheduler.clear(state); notifications.clear()
                save(ScheduledNotifyState(host = target, legacyImported = true))
            }
            ScheduledNotifyJobs.periodic(app)
            // Repair once per process or permission transition, not on every unchanged sync.
            val exact = scheduler.exactAllowed()
            if (restoredHost != target || restoredExact != exact) {
                scheduler.restore(state, now())
                restoredHost = target; restoredExact = exact
            }
            sync(target, ticket)
            val snapshot = state.snapshot
            main.post { if (current(target, ticket)) callback(snapshot) }
        }
    }

    fun deactivate() {
        epoch++; host = null
        store.setEnabled(false)
        execute(priority = 0) {
            scheduler.clear(state); notifications.clear()
            restoredHost = null; restoredExact = null
            save(ScheduledNotifyState(legacyImported = true))
            ScheduledNotifyJobs.cancel(app)
        }
    }

    fun changed(callback: (ScheduledNotifySnapshot?) -> Unit) {
        changeSerial.incrementAndGet()
        if (!changeQueued.compareAndSet(false, true)) return
        val target = host
        val ticket = epoch
        val requested = changeSerial.get()
        execute {
            try {
                if (target == null || !current(target, ticket) || state.host != target) return@execute
                sync(target, ticket)
                val snapshot = state.snapshot
                main.post { if (current(target, ticket)) callback(snapshot) }
            } finally {
                changeQueued.set(false)
                if (requested != changeSerial.get()) main.post { changed(callback) }
            }
        }
    }

    fun restore(done: () -> Unit) = execute(done, priority = 0) {
        val selected = ServerCatalog(app.getSharedPreferences("b0-host", Context.MODE_PRIVATE)).selected()
        if (selected?.address != state.host || host == null) {
            epoch++; host = null
            scheduler.clear(state); notifications.clear(); save(ScheduledNotifyState(legacyImported = true))
            ScheduledNotifyJobs.cancel(app)
        } else {
            scheduler.restore(state, now())
            ScheduledNotifyJobs.periodic(app)
            ScheduledNotifyJobs.once(app)
        }
    }

    fun background(done: () -> Unit) = execute(done) {
        val target = host ?: return@execute
        val ticket = epoch
        val selected = ServerCatalog(app.getSharedPreferences("b0-host", Context.MODE_PRIVATE)).selected()
        if (!current(target, ticket) || state.host != target || selected?.address != target) return@execute
        sync(target, ticket)
        for ((key, at) in state.pendingDaily.toMap()) {
            if (!current(target, ticket)) break
            try { dailyContent(target, ticket, key, at) }
            catch (_: Exception) { if (current(target, ticket)) failure(target) }
        }
        if (current(target, ticket)) scheduler.daily(state, now())
    }

    fun receive(target: String?, key: String?, at: Long, action: String?, actionId: String?, done: () -> Unit) = execute(done, priority = 0) {
        if (target == null || target != host || state.host != target || key == null) return@execute
        val selected = ServerCatalog(app.getSharedPreferences("b0-host", Context.MODE_PRIVATE)).selected()
        if (selected?.address != target) return@execute
        val ticket = epoch
        if (state.snapshot?.daily?.any { it.key == key } == true && action == ScheduledNotifyScheduler.ACTION_ALARM) {
            save(state.copy(pendingDaily = state.pendingDaily + (key to at)))
            scheduler.daily(state, now())
            ScheduledNotifyJobs.once(app, daily = true)
            return@execute
        }
        val alarm = state.alarms.firstOrNull { it.item.key == key } ?: return@execute
        when (action) {
            ScheduledNotifyScheduler.ACTION_ALARM -> {
                if (alarm.delivered || alarm.at != at) return@execute
                // Mark delivered even without notification permission; never replay stale reminders.
                save(state.copy(alarms = state.alarms.map { if (it == alarm) it.copy(delivered = true) else it },
                    delivered = state.delivered + key))
                notifications.item(target, alarm)
            }
            ScheduledNotifyNotifications.SNOOZE -> {
                if (!alarm.item.snooze) return@execute
                val snoozed = ScheduledNotifyGate.snooze(alarm, now())
                save(state.copy(alarms = state.alarms.map { if (it == alarm) snoozed else it }))
                scheduler.schedule(target, key, snoozed.at)
                notifications.cancel(key)
            }
            ScheduledNotifyNotifications.ACTION -> {
                if (actionId == null || alarm.item.actions.none { it.id == actionId }) return@execute
                try {
                    val payload = JsonObject().apply { addProperty("key", key); addProperty("action", actionId) }
                    ScheduledNotifyWire.action(request(target, "/api/mobile-schedule/action", ticket, payload), key, actionId)
                    if (!current(target, ticket)) return@execute
                    // Keep the delivered tombstone across future versions, including for a snoozed alarm.
                    save(state.copy(alarms = state.alarms.map { if (it == alarm) it.copy(delivered = true) else it },
                    delivered = state.delivered + key))
                    scheduler.cancel(target, key); notifications.cancel(key)
                    ScheduledNotifyJobs.once(app)
                } catch (_: Exception) {
                    if (current(target, ticket)) notifications.item(target, alarm, failed = true)
                }
            }
        }
    }

    private fun sync(target: String, ticket: Long) {
        try {
            // Include the previous day so a local snooze survives ordinary hourly syncs.
            val from = Instant.ofEpochMilli(now() - ScheduledNotifyGate.DAY)
            val to = from.plusSeconds(8 * 24 * 60 * 60)
            val snapshot = ScheduledNotifyWire.snapshot(request(target, "/api/mobile-schedule?from=$from&to=$to", ticket))
            if (!current(target, ticket)) return
            if (ScheduledNotifyGate.changed(state.snapshot?.version, snapshot.version)) {
                val diff = ScheduledNotifyGate.diff(state.alarms, snapshot, now(), state.delivered)
                // Persist desired state before scheduling; restart/boot can repair interrupted additions.
                // Cancel removed alarms first, so they cannot survive an interrupted state commit.
                state.snapshot?.daily?.filter { old -> snapshot.daily.none { it.key == old.key } }?.forEach {
                    scheduler.cancel(target, it.key); notifications.cancel(it.key)
                }
                diff.cancel.forEach { scheduler.cancel(target, it.item.key); notifications.cancel(it.item.key) }
                save(state.copy(snapshot = snapshot, alarms = diff.retained + diff.schedule,
                    pendingDaily = state.pendingDaily.filterKeys { key -> snapshot.daily.any { it.key == key } }, failure = ScheduledNotifyFailure(), needsRestore = true))
                diff.schedule.forEach { scheduler.schedule(target, it.item.key, it.at) }
                scheduler.daily(state, now())
                save(state.copy(needsRestore = false))
            } else {
                if (state.needsRestore) scheduler.restore(state, now())
                save(state.copy(failure = ScheduledNotifyFailure(), needsRestore = false))
            }
            notifications.cancel(ScheduledNotifyNotifications.LOGIN)
        } catch (_: Exception) { if (current(target, ticket)) failure(target) }
    }

    private fun failure(target: String) {
        var failed = ScheduledNotifyGate.failed(state.failure, now())
        if (ScheduledNotifyGate.shouldWarn(failed, now()) && notifications.login(target)) failed = failed.copy(notified = true)
        save(state.copy(failure = failed))
    }

    private fun dailyContent(target: String, ticket: Long, key: String, at: Long) {
        val daily = state.snapshot?.daily?.firstOrNull { it.key == key } ?: return
        val date = ScheduledNotifyGate.date(daily, now())
        val token = ScheduledNotifyGate.dailyToken(key, date)
        if (ScheduledNotifyGate.date(daily, at) != date || token in state.dailyDelivered) {
            save(state.copy(pendingDaily = state.pendingDaily - key)); return
        }
        val encoded = java.net.URLEncoder.encode(key, "UTF-8")
        val result = ScheduledNotifyWire.content(request(target, "/api/mobile-schedule/content?key=$encoded&date=$date", ticket))
        if (!current(target, ticket) || result.key != key || result.date != date) return
        if (result.shouldNotify && !notifications.daily(target, result)) return
        save(state.copy(dailyDelivered = state.dailyDelivered + token, pendingDaily = state.pendingDaily - key))
    }

    private fun request(target: String, path: String, ticket: Long, body: JsonObject? = null): String {
        check(current(target, ticket))
        val address = HostAddress.parse(target)
        val cookie = cookies.getCookie(address.origin + "/").orEmpty()
        check(cookie.isNotEmpty() && current(target, ticket))
        val connection = HostHttp.open(address.origin + path, cookie, if (body == null) "GET" else "POST", 3000)
        return try {
            connection.setRequestProperty("Accept", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                connection.setRequestProperty("Origin", address.origin)
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            check(connection.responseCode == 200)
            connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                val text = StringBuilder()
                val buffer = CharArray(4096)
                while (true) {
                    val count = reader.read(buffer)
                    if (count < 0) break
                    check(text.length + count <= 1024 * 1024)
                    text.append(buffer, 0, count)
                }
                text.toString()
            }
        } finally { connection.disconnect() }
    }

    private fun execute(done: () -> Unit = {}, priority: Int = 10, action: () -> Unit) {
        worker.execute(Task(priority, sequence.incrementAndGet()) {
            try { action() }
            catch (_: Exception) { /* Preserve durable state; retry on next trigger. */ }
            finally { main.post(done) }
        })
    }
    companion object {
        @Volatile private var instance: ScheduledNotifySync? = null
        fun get(context: Context): ScheduledNotifySync = instance ?: synchronized(this) {
            instance ?: ScheduledNotifySync(context).also { instance = it }
        }
    }
}
