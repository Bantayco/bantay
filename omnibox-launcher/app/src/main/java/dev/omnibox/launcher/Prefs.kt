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

    // --- Search history -------------------------------------------------------------------

    fun history(): List<String> = synchronized(lock) {
        val json = sp.getString("history", null) ?: return emptyList()
        try {
            val arr = JSONArray(json)
            List(arr.length()) { arr.getString(it) }
        } catch (e: Exception) {
            emptyList()
        }
    }

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
    }
}
