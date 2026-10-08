package dev.omnibox.launcher

import android.app.Activity
import android.content.Intent
import android.graphics.drawable.Drawable
import android.view.View
import java.util.Locale

/** Where a result is shown. Display order is decided in [MainActivity]. */
enum class Section { CLIPBOARD, ANSWER, ACTIONS, FREQUENT, APPS, CONTACTS, SHORTCUTS, SETTINGS, WEB, HISTORY, SUGGEST }

class Query(val raw: String) {
    val text: String = raw.trim()
    val lower: String = text.lowercase(Locale.getDefault())
    val isEmpty: Boolean get() = text.isEmpty()
}

/** A secondary icon button on a result row (e.g. "call" and "message" on a contact). */
class RowAction(val icon: Drawable?, val description: String, val run: (Host) -> Unit)

class Result(
    val section: Section,
    val key: String,
    val title: CharSequence,
    val subtitle: CharSequence? = null,
    val icon: Drawable? = null,
    val score: Int = 0,
    val style: Style = Style.ROW,
    /** Text to put into the search box when the "fill" arrow is tapped. */
    val fill: String? = null,
    val actions: List<RowAction> = emptyList(),
    /** Run automatically when this was produced from a voice query. */
    val voiceAuto: Boolean = false,
    val onLongClick: ((Host, View) -> Unit)? = null,
    val onClick: (Host) -> Unit,
) {
    enum class Style { ROW, ANSWER, APP }
}

/** A source of results. Network providers run after local ones, debounced. */
interface Provider {
    val id: String
    val network: Boolean get() = false
    fun query(q: Query): List<Result>
}

/** What results can do to the omnibox when tapped. Implemented by [MainActivity]. */
interface Host {
    val activity: Activity
    val prefs: Prefs
    fun launch(intent: Intent, vararg fallbacks: Intent): Boolean
    fun launchApp(app: AppEntry)
    fun showAppMenu(app: AppEntry, anchor: View)
    fun webSearch(query: String)
    fun openUrl(url: String)
    fun setQuery(text: String)
    fun refresh()
    fun copyToClipboard(text: String)
    fun toast(message: String)
    fun requestPermission(permission: String)
}
