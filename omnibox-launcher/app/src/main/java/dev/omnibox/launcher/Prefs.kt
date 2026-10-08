package dev.omnibox.launcher

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

class Prefs(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("omnibox", Context.MODE_PRIVATE)
    private val lock = Any()
    private var launchCache: Map<String, Int>? = null

    var engine: SearchEngine
        get() = SearchEngine.fromId(sp.getString("engine", null))
        set(value) = sp.edit().putString("engine", value.id).apply()

    var webSuggestions: Boolean
        get() = sp.getBoolean("web_suggestions", true)
        set(value) = sp.edit().putBoolean("web_suggestions", value).apply()

    var contactsEnabled: Boolean
        get() = sp.getBoolean("contacts", true)
        set(value) = sp.edit().putBoolean("contacts", value).apply()

    var contactsPromptDismissed: Boolean
        get() = sp.getBoolean("contacts_prompt_dismissed", false)
        set(value) = sp.edit().putBoolean("contacts_prompt_dismissed", value).apply()

    var weatherEnabled: Boolean
        get() = sp.getBoolean("weather", true)
        set(value) = sp.edit().putBoolean("weather", value).apply()

    var saveHistory: Boolean
        get() = sp.getBoolean("save_history", true)
        set(value) = sp.edit().putBoolean("save_history", value).apply()

    var keyboardOnHome: Boolean
        get() = sp.getBoolean("keyboard_on_home", false)
        set(value) = sp.edit().putBoolean("keyboard_on_home", value).apply()

    var showClipboard: Boolean
        get() = sp.getBoolean("clipboard", true)
        set(value) = sp.edit().putBoolean("clipboard", value).apply()

    /** Pixel-style layout: dock + search bar at the bottom of the home screen. */
    var barAtBottom: Boolean
        get() = sp.getBoolean("bar_at_bottom", true)
        set(value) = sp.edit().putBoolean("bar_at_bottom", value).apply()

    var themedIcons: Boolean
        get() = sp.getBoolean("themed_icons", true)
        set(value) = sp.edit().putBoolean("themed_icons", value).apply()

    // --- Dock (pinned apps above the bar) -------------------------------------------------

    fun dock(): List<String> = synchronized(lock) { readList("dock") }

    fun setDocked(key: String, docked: Boolean) = synchronized(lock) {
        val list = readList("dock").filterNot { it == key }.toMutableList()
        if (docked) list.add(key)
        sp.edit().putString("dock", JSONArray(list.take(MAX_DOCK)).toString()).apply()
    }

    private fun readList(name: String): List<String> {
        val json = sp.getString(name, null) ?: return emptyList()
        return try {
            val arr = JSONArray(json)
            List(arr.length()) { arr.getString(it) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    // --- Search history -------------------------------------------------------------------

    fun history(): List<String> = synchronized(lock) { readList("history") }

    fun addHistory(query: String) = synchronized(lock) {
        val q = query.trim()
        if (q.isEmpty() || !saveHistory) return@synchronized
        val list = history().filterNot { it.equals(q, ignoreCase = true) }.toMutableList()
        list.add(0, q)
        writeHistory(list.take(MAX_HISTORY))
    }

    fun removeHistory(query: String) = synchronized(lock) {
        writeHistory(history().filterNot { it == query })
    }

    fun clearHistory() = synchronized(lock) { writeHistory(emptyList()) }

    private fun writeHistory(list: List<String>) {
        sp.edit().putString("history", JSONArray(list).toString()).apply()
    }

    // --- App launch counts (ranking) ------------------------------------------------------

    fun launchCounts(): Map<String, Int> = synchronized(lock) {
        launchCache?.let { return@synchronized it }
        val map = HashMap<String, Int>()
        try {
            val obj = JSONObject(sp.getString("launch_counts", "{}") ?: "{}")
            for (k in obj.keys()) map[k] = obj.optInt(k)
        } catch (e: Exception) {
            // Corrupt data: start over.
        }
        launchCache = map
        map
    }

    fun recordLaunch(key: String) = synchronized(lock) {
        val map = HashMap(launchCounts())
        map[key] = (map[key] ?: 0) + 1
        launchCache = map
        sp.edit().putString("launch_counts", JSONObject(map as Map<*, *>).toString()).apply()
    }

    companion object {
        private const val MAX_HISTORY = 50
        const val MAX_DOCK = 5
    }
}
