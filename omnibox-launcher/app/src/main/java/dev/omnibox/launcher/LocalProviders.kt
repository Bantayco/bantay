package dev.omnibox.launcher

import android.content.Context
import android.content.Intent
import android.provider.Settings
import kotlin.math.min

internal fun glyph(text: String) = GlyphDrawable(text, Palette.GLYPH_BG, Palette.TEXT, 0.9f)

/** Installed apps: all apps (empty query), frequent apps, and fuzzy matches while typing. */
class AppProvider(private val repo: AppRepository, private val prefs: Prefs) : Provider {
    override val id = "apps"

    override fun query(q: Query): List<Result> {
        val apps = repo.apps
        val counts = prefs.launchCounts()
        if (q.isEmpty) {
            val frequent = apps.filter { (counts[it.key] ?: 0) > 0 }
                .sortedByDescending { counts[it.key] ?: 0 }
                .take(FREQUENT)
            return frequent.map { result(it, Section.FREQUENT, 0, false) } +
                apps.map { result(it, Section.APPS, 0, false) }
        }
        var term = q.lower
        var explicit = false
        for (prefix in listOf("open ", "launch ", "start ", "run ")) {
            if (term.startsWith(prefix)) {
                term = term.removePrefix(prefix).trim()
                explicit = true
                break
            }
        }
        if (term.isEmpty()) return emptyList()
        val scored = apps.mapNotNull { app ->
            val s = Fuzzy.score(app.label, term)
            if (s > 0) app to s + min(counts[app.key] ?: 0, 50) else null
        }.sortedByDescending { it.second }.take(MAX_MATCHES)
        return scored.mapIndexed { i, (app, s) -> result(app, Section.APPS, s, explicit && i == 0 && s >= 800) }
    }

    private fun result(app: AppEntry, section: Section, score: Int, voiceAuto: Boolean) = Result(
        section = section,
        key = section.name + app.key,
        title = app.label,
        icon = app.icon(),
        score = score,
        style = Result.Style.APP,
        voiceAuto = voiceAuto,
        onLongClick = { host, view -> host.showAppMenu(app, view) },
        onClick = { host -> host.launchApp(app) },
    )

    companion object {
        const val FREQUENT = 5
        const val MAX_MATCHES = 10
    }
}

/** App shortcuts (e.g. "New message", "Navigate home") — available when Omnibox is the default home app. */
class ShortcutProvider(private val repo: AppRepository) : Provider {
    override val id = "shortcuts"

    override fun query(q: Query): List<Result> {
        if (q.text.length < 2) return emptyList()
        val labels = repo.apps.associate { it.packageName to it.label }
        return repo.shortcuts.mapNotNull { info ->
            val label = (info.shortLabel ?: return@mapNotNull null).toString()
            val appLabel = labels[info.`package`] ?: ""
            val combined = "$appLabel $label"
            val s = maxOf(Fuzzy.score(label, q.lower), Fuzzy.score(combined, q.lower) - 200)
            if (s >= 350) Triple(info, label, appLabel) to s else null
        }.sortedByDescending { it.second }.take(3).map { (t, s) ->
            val (info, label, appLabel) = t
            Result(
                section = Section.SHORTCUTS,
                key = "shortcut:" + info.`package` + "/" + info.id,
                title = label,
                subtitle = appLabel,
                icon = repo.shortcutIcon(info),
                score = s,
                onClick = { host -> if (!repo.startShortcut(info)) host.toast("Couldn't open shortcut") },
            )
        }
    }
}

/** Jump straight to a system settings page ("wifi", "battery", "dark mode"...). */
class SettingsProvider(private val context: Context) : Provider {
    override val id = "settings"

    private class Entry(val label: String, val keywords: List<String>, vararg val actions: String)

    private val entries = listOf(
        Entry("Wi-Fi", listOf("wifi", "wi-fi", "wireless", "internet", "network"), Settings.ACTION_WIFI_SETTINGS),
        Entry("Bluetooth", listOf("bluetooth", "pair", "headphones"), Settings.ACTION_BLUETOOTH_SETTINGS),
        Entry("Mobile network", listOf("mobile data", "cellular", "sim", "roaming", "carrier"), Settings.ACTION_DATA_ROAMING_SETTINGS),
        Entry("Airplane mode", listOf("airplane", "flight mode", "aeroplane"), Settings.ACTION_AIRPLANE_MODE_SETTINGS),
        Entry("Hotspot & tethering", listOf("hotspot", "tethering"), Settings.ACTION_WIRELESS_SETTINGS),
        Entry("Display", listOf("display", "brightness", "dark mode", "dark theme", "screen timeout", "font size"), Settings.ACTION_DISPLAY_SETTINGS),
        Entry("Sound & vibration", listOf("sound", "volume", "ringtone", "vibration", "vibrate"), Settings.ACTION_SOUND_SETTINGS),
        Entry("Do Not Disturb", listOf("do not disturb", "dnd", "silence", "quiet"), "android.settings.ZEN_MODE_SETTINGS"),
        Entry("Notifications", listOf("notifications"), "android.settings.ALL_APPS_NOTIFICATION_SETTINGS", "android.settings.NOTIFICATION_SETTINGS"),
        Entry("Battery", listOf("battery", "power", "battery saver"), Intent.ACTION_POWER_USAGE_SUMMARY, Settings.ACTION_BATTERY_SAVER_SETTINGS),
        Entry("Storage", listOf("storage", "free space", "disk"), Settings.ACTION_INTERNAL_STORAGE_SETTINGS),
        Entry("Apps", listOf("apps", "applications", "manage apps", "app list"), Settings.ACTION_APPLICATION_SETTINGS),
        Entry("Default apps", listOf("default apps", "default browser", "default launcher", "home app"), Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS, Settings.ACTION_HOME_SETTINGS),
        Entry("Location", listOf("location", "gps"), Settings.ACTION_LOCATION_SOURCE_SETTINGS),
        Entry("Security", listOf("security", "lock screen", "screen lock", "fingerprint", "face unlock", "password"), Settings.ACTION_SECURITY_SETTINGS),
        Entry("Privacy", listOf("privacy", "permissions"), Settings.ACTION_PRIVACY_SETTINGS),
        Entry("Accounts", listOf("accounts", "sync", "google account"), Settings.ACTION_SYNC_SETTINGS),
        Entry("Accessibility", listOf("accessibility", "talkback", "magnification"), Settings.ACTION_ACCESSIBILITY_SETTINGS),
        Entry("Languages", listOf("language", "locale", "region"), Settings.ACTION_LOCALE_SETTINGS),
        Entry("Keyboard", listOf("keyboard", "input method"), Settings.ACTION_INPUT_METHOD_SETTINGS),
        Entry("Date & time", listOf("date", "time zone", "timezone"), Settings.ACTION_DATE_SETTINGS),
        Entry("NFC", listOf("nfc", "tap to pay", "contactless"), Settings.ACTION_NFC_SETTINGS),
        Entry("VPN", listOf("vpn"), Settings.ACTION_VPN_SETTINGS),
        Entry("Cast", listOf("cast", "screen mirroring", "chromecast"), Settings.ACTION_CAST_SETTINGS),
        Entry("Wallpaper", listOf("wallpaper", "background"), Intent.ACTION_SET_WALLPAPER),
        Entry("Developer options", listOf("developer", "usb debugging", "adb"), Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS),
        Entry("About phone", listOf("about phone", "device info", "android version", "build number"), Settings.ACTION_DEVICE_INFO_SETTINGS),
        Entry("System update", listOf("system update", "software update", "update"), "android.settings.SYSTEM_UPDATE_SETTINGS"),
        Entry("Digital assistant", listOf("assistant", "voice input", "digital assistant"), Settings.ACTION_VOICE_INPUT_SETTINGS),
        Entry("All settings", listOf("settings", "preferences", "system settings"), Settings.ACTION_SETTINGS),
        Entry("Omnibox settings", listOf("omnibox", "launcher settings", "search settings", "search engine"), ACTION_OMNIBOX_SETTINGS),
    )

    override fun query(q: Query): List<Result> {
        if (q.text.length < 3) return emptyList()
        val term = q.lower.removeSuffix(" settings").removeSuffix(" setting").trim()
        if (term.isEmpty()) return emptyList()
        return entries.mapNotNull { e ->
            val label = e.label.lowercase()
            val s = when {
                label.startsWith(term) -> 700
                e.keywords.any { it.startsWith(term) } -> 600
                e.keywords.any { term.startsWith("$it ") || term == it } -> 600
                label.contains(term) -> 400
                else -> 0
            }
            if (s > 0) e to s else null
        }.sortedByDescending { it.second }.take(2).map { (e, s) ->
            Result(
                section = Section.SETTINGS,
                key = "settings:" + e.label,
                title = e.label,
                subtitle = "Settings",
                icon = glyph("⚙️"),
                score = s,
                onClick = { host ->
                    if (e.actions.first() == ACTION_OMNIBOX_SETTINGS) {
                        host.launch(Intent(context, SettingsActivity::class.java))
                    } else {
                        val intents = e.actions.map { Intent(it) } + Intent(Settings.ACTION_SETTINGS)
                        host.launch(intents.first(), *intents.drop(1).toTypedArray())
                    }
                },
            )
        }
    }

    companion object {
        private const val ACTION_OMNIBOX_SETTINGS = "omnibox:settings"
    }
}

/** Recent searches: shown on the home screen and as matches while typing. */
class HistoryProvider(private val context: Context, private val prefs: Prefs) : Provider {
    override val id = "history"

    override fun query(q: Query): List<Result> {
        val history = prefs.history()
        val items = if (q.isEmpty) {
            history.take(5)
        } else {
            history.filter { it.contains(q.text, ignoreCase = true) && !it.equals(q.text, ignoreCase = true) }.take(3)
        }
        return items.mapIndexed { i, h ->
            Result(
                section = Section.HISTORY,
                key = "history:$h",
                title = h,
                icon = context.tintedIcon(android.R.drawable.ic_menu_recent_history),
                score = 100 - i,
                fill = h,
                onLongClick = { host, _ ->
                    prefs.removeHistory(h)
                    host.toast("Removed from history")
                    host.refresh()
                },
                onClick = { host -> host.webSearch(h) },
            )
        }
    }
}

/** The "Search <engine> for …" row; pressing Enter does the same thing. */
class WebProvider(private val context: Context, private val prefs: Prefs) : Provider {
    override val id = "web"

    override fun query(q: Query): List<Result> {
        if (q.isEmpty) return emptyList()
        return listOf(
            Result(
                section = Section.WEB,
                key = "web:" + q.text,
                title = q.text,
                subtitle = "Search ${prefs.engine.label}",
                icon = context.tintedIcon(R.drawable.ic_search),
                score = 1000,
                onClick = { host -> host.webSearch(q.text) },
            ),
        )
    }
}
