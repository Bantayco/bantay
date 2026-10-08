package dev.omnibox.launcher

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

/** Omnibox preferences: search engine, which sources to search, history and default-app shortcuts. */
class SettingsActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        Palette.apply(this)
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(8), 0, dp(32))
        }
        val scroll = ScrollView(this).apply {
            fitsSystemWindows = true
            addView(content)
        }
        setContentView(scroll)
        build()
    }

    private fun build() {
        content.removeAllViews()

        header("Search")
        row("Search engine", prefs.engine.label) { chooseEngine() }
        toggle("Search suggestions", "Show suggestions from ${prefs.engine.label} as you type", prefs.webSuggestions) {
            prefs.webSuggestions = it
        }
        toggle("Contacts", "Find people and call, text or email them", prefs.contactsEnabled && hasPermission(Manifest.permission.READ_CONTACTS)) {
            prefs.contactsEnabled = it
            if (it) {
                prefs.contactsPromptDismissed = false
                ask(Manifest.permission.READ_CONTACTS)
            }
        }
        toggle("Local weather", "Use your approximate location for \"weather\"", prefs.weatherEnabled) {
            prefs.weatherEnabled = it
            if (it) ask(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
        toggle("Clipboard suggestion", "Offer to search text you just copied", prefs.showClipboard) {
            prefs.showClipboard = it
        }

        header("History")
        toggle("Save search history", "Recent searches appear on the home screen", prefs.saveHistory) {
            prefs.saveHistory = it
        }
        row("Clear search history", "${prefs.history().size} saved searches") {
            AlertDialog.Builder(this)
                .setTitle("Clear search history?")
                .setPositiveButton("Clear") { _, _ ->
                    prefs.clearHistory()
                    build()
                }
                .setNegativeButton("Cancel", null)
                .show()
        }

        header("Home screen")
        toggle("Search bar at the bottom", "Pixel-style: dock and search bar at the bottom; swipe up for all apps", prefs.barAtBottom) {
            prefs.barAtBottom = it
        }
        toggle("Themed icons", "Tint app icons to match your wallpaper (Android 13+)", prefs.themedIcons) {
            prefs.themedIcons = it
        }
        toggle("Open keyboard on Home", "Pressing Home goes straight to typing", prefs.keyboardOnHome) {
            prefs.keyboardOnHome = it
        }
        row("Set as default home app", "Use Omnibox as your launcher") {
            open(Intent(Settings.ACTION_HOME_SETTINGS), Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
        }
        row("Set as digital assistant", "Long-press Home / swipe from a corner to open Omnibox") {
            open(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS), Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
        }
        row("Add the search bar widget", "Long-press your home screen › Widgets › Omnibox", null)
        row("Add the quick settings tile", "Edit quick settings › drag \"Omnibox search\"", null)

        header("About")
        val version = try {
            packageManager.getPackageInfo(packageName, 0).versionName
        } catch (e: PackageManager.NameNotFoundException) {
            null
        }
        row("Omnibox ${version ?: ""}".trim(), "Search apps, contacts, settings, answers and the web", null)
    }

    private fun hasPermission(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun ask(p: String) {
        if (!hasPermission(p)) requestPermissions(arrayOf(p), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        build()
    }

    private fun chooseEngine() {
        val engines = SearchEngine.entries
        AlertDialog.Builder(this)
            .setTitle("Search engine")
            .setSingleChoiceItems(engines.map { it.label }.toTypedArray(), engines.indexOf(prefs.engine)) { dialog, which ->
                prefs.engine = engines[which]
                dialog.dismiss()
                build()
            }
            .show()
    }

    private fun open(intent: Intent, fallback: Intent) {
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            try {
                startActivity(fallback)
            } catch (e2: ActivityNotFoundException) {
                Toast.makeText(this, "Not available on this device", Toast.LENGTH_SHORT).show()
            }
        }
    }

    // --- Tiny view builders -------------------------------------------------------------------

    private fun header(title: String) {
        content.addView(TextView(this).apply {
            text = title
            textSize = 14f
            setTextColor(Palette.ACCENT)
            setPadding(dp(20), dp(24), dp(20), dp(8))
        })
    }

    private fun texts(title: String, subtitle: String?): Pair<LinearLayout, TextView> {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        box.addView(TextView(this).apply {
            text = title
            textSize = 17f
            setTextColor(Palette.TEXT)
        })
        val sub = TextView(this).apply {
            text = subtitle
            textSize = 14f
            setTextColor(Palette.TEXT_DIM)
            visibility = if (subtitle.isNullOrEmpty()) View.GONE else View.VISIBLE
        }
        box.addView(sub)
        return box to sub
    }

    private fun row(title: String, subtitle: String?, onClick: (() -> Unit)?): TextView {
        val (box, sub) = texts(title, subtitle)
        box.setPadding(dp(20), dp(14), dp(20), dp(14))
        if (onClick != null) {
            box.setRippleBackground(0f)
            box.setOnClickListener { onClick() }
        }
        content.addView(box, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        return sub
    }

    private fun toggle(title: String, subtitle: String, checked: Boolean, onChange: (Boolean) -> Unit) {
        val line = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(12), dp(16), dp(12))
            setRippleBackground(0f)
        }
        val (box, _) = texts(title, subtitle)
        line.addView(box, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        @Suppress("DEPRECATION")
        val switch = Switch(this).apply { isChecked = checked }
        switch.setOnCheckedChangeListener { _, value -> onChange(value) }
        line.setOnClickListener { switch.toggle() }
        line.addView(switch)
        content.addView(line, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }
}
