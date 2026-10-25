package com.jarvis.b0

import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

internal data class SavedServer(val address: String, val name: String) {
    val host: HostAddress get() = HostAddress.parse(address)
    val label: String get() = name.ifBlank { host.base.authority }
}

/** Addresses and labels only. Passwords, launch tokens, and Cookie values never enter this store. */
internal class ServerCatalog(private val preferences: SharedPreferences) {
    fun all(): List<SavedServer> {
        val parsed = runCatching {
            val array = JSONArray(preferences.getString("servers-v1", "[]"))
            (0 until array.length()).mapNotNull { index ->
                val item = array.optJSONObject(index) ?: return@mapNotNull null
                val host = runCatching { HostAddress.parse(item.optString("address")) }.getOrNull() ?: return@mapNotNull null
                SavedServer(host.base.toASCIIString(), item.optString("name").take(80))
            }
        }.getOrDefault(emptyList())
        if (parsed.isNotEmpty()) return parsed.distinctBy { it.host.origin }
        val legacy = (preferences.getString("base", null) ?: preferences.getString("cookie-origin", null))?.let {
            runCatching { HostAddress.parse(it) }.getOrNull()
        } ?: return emptyList()
        return listOf(SavedServer(legacy.base.toASCIIString(), "我的服务器"))
    }

    fun selected(): SavedServer? {
        val items = all()
        val chosen = preferences.getString("selected-origin", null)
            ?: (preferences.getString("base", null) ?: preferences.getString("cookie-origin", null))
                ?.let { runCatching { HostAddress.parse(it).origin }.getOrNull() }
        return items.firstOrNull { it.host.origin == chosen } ?: items.firstOrNull()
    }

    fun save(server: SavedServer, select: Boolean = true) {
        val normalized = server.copy(address = server.host.base.toASCIIString(), name = server.name.take(80))
        val items = all().filterNot { it.host.origin == normalized.host.origin } + normalized
        val array = JSONArray()
        items.forEach { array.put(JSONObject().put("address", it.address).put("name", it.name)) }
        preferences.edit().putString("servers-v1", array.toString()).apply {
            if (select) putString("selected-origin", normalized.host.origin)
        }.apply()
    }

    fun replace(old: SavedServer, updated: SavedServer) {
        val normalized = updated.copy(address = updated.host.base.toASCIIString(), name = updated.name.take(80))
        val array = JSONArray()
        (all().filterNot { it.host.origin == old.host.origin || it.host.origin == normalized.host.origin } + normalized)
            .forEach { array.put(JSONObject().put("address", it.address).put("name", it.name)) }
        preferences.edit().putString("servers-v1", array.toString())
            .putString("selected-origin", normalized.host.origin).apply()
    }

    fun choose(server: SavedServer) {
        preferences.edit().putString("selected-origin", server.host.origin).apply()
    }

    fun username(): String = preferences.getString("username", "").orEmpty()
    fun saveUsername(username: String) { preferences.edit().putString("username", username.take(128)).apply() }
}
