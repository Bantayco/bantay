package dev.omnibox.launcher

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.provider.MediaStore
import android.app.SearchManager

/**
 * Turns what was typed into something to *do*: open a URL, dial a number, set a timer or alarm,
 * navigate, add a calendar event, play music, translate, define, toggle the flashlight, Lens...
 */
class ActionProvider(private val context: Context, private val torch: TorchController) : Provider {
    override val id = "actions"

    override fun query(q: Query): List<Result> {
        if (q.isEmpty) return emptyList()
        val t = q.text
        val out = ArrayList<Result>()

        Parsers.url(t)?.let { m ->
            out += action("url", "Open ${m.url.removePrefix("https://")}", m.url, "🌐", if (m.confident) 900 else 300, m.confident) {
                it.openUrl(m.url)
            }
        }
        Parsers.email(t)?.let { e ->
            out += action("email", "Email $e", "Compose a message", "✉️", 800, false) {
                it.launch(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$e")))
            }
        }
        Parsers.phone(t)?.let { p ->
            val tel = Uri.encode(p)
            out += action("call", "Call $p", "Phone", "📞", 800, false) {
                it.launch(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$tel")))
            }
            out += action("sms", "Message $p", "SMS", "💬", 700, false) {
                it.launch(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$tel")))
            }
            out += action("addcontact", "Add $p to contacts", null, "👤", 600, false) {
                it.launch(
                    Intent(ContactsContract.Intents.Insert.ACTION)
                        .setType(ContactsContract.RawContacts.CONTENT_TYPE)
                        .putExtra(ContactsContract.Intents.Insert.PHONE, p),
                )
            }
        }
        Parsers.timerSeconds(t)?.let { seconds ->
            out += action("timer", "Set timer for ${describeDuration(seconds)}", "Clock", "⏱️", 950, true) {
                it.launch(
                    Intent(AlarmClock.ACTION_SET_TIMER)
                        .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
                        .putExtra(AlarmClock.EXTRA_SKIP_UI, false),
                )
            }
        }
        Parsers.alarmTime(t)?.let { (h, m) ->
            out += action("alarm", "Set alarm for ${"%d:%02d".format(h, m)}", "Clock", "⏰", 950, true) {
                it.launch(
                    Intent(AlarmClock.ACTION_SET_ALARM)
                        .putExtra(AlarmClock.EXTRA_HOUR, h)
                        .putExtra(AlarmClock.EXTRA_MINUTES, m)
                        .putExtra(AlarmClock.EXTRA_SKIP_UI, false),
                )
            }
        }
        when (q.lower) {
            "alarm", "alarms", "show alarms" -> out += action("alarms", "Show alarms", "Clock", "⏰", 700, true) {
                it.launch(Intent(AlarmClock.ACTION_SHOW_ALARMS))
            }
            "timer", "timers", "show timers" -> out += action("timers", "Show timers", "Clock", "⏱️", 700, true) {
                it.launch(Intent(AlarmClock.ACTION_SHOW_TIMERS))
            }
            "song", "what song is this", "what's this song", "whats this song", "identify song", "song search",
            "name that song", "what song is playing", "hum to search", "shazam" ->
                out += action("song", "What's this song?", "Listen and identify music playing nearby", "🎵", 900, true) {
                    it.launch(songIntent(), *songFallbacks(context))
                }
            "lens", "google lens", "search image", "image search", "visual search", "scan" ->
                out += action("lens", "Search with your camera", "Google Lens", "📷", 900, true) {
                    it.launch(lensIntent(), *lensFallbacks())
                }
        }
        Parsers.navigateTo(t)?.let { place ->
            val e = Uri.encode(place)
            out += action("navigate", "Directions to $place", "Maps", "🧭", 900, true) {
                it.launch(
                    Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=$e")),
                    Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=$e")),
                    Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/dir/?api=1&destination=$e")),
                )
            }
        }
        Parsers.nearMe(t)?.let { what ->
            val e = Uri.encode(what)
            out += action("nearby", "Find $what nearby", "Maps", "📍", 850, true) {
                it.launch(
                    Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=$e")),
                    Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=$e")),
                )
            }
        }
        Parsers.calendarEvent(t)?.let { title ->
            out += action("event", "Add \"$title\" to calendar", "Calendar", "📅", 850, true) {
                it.launch(
                    Intent(Intent.ACTION_INSERT)
                        .setData(CalendarContract.Events.CONTENT_URI)
                        .putExtra(CalendarContract.Events.TITLE, title),
                )
            }
        }
        Parsers.play(t)?.let { what ->
            out += action("play", "Play $what", "Music", "▶️", 800, true) {
                it.launch(
                    Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH)
                        .putExtra(SearchManager.QUERY, what)
                        .putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*"),
                    Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(what))),
                )
            }
        }
        Parsers.translate(t)?.let { tr ->
            val target = tr.languageCode?.let { "&tl=$it" } ?: ""
            val url = "https://translate.google.com/?sl=auto$target&op=translate&text=" + Uri.encode(tr.text)
            out += action("translate", "Translate \"${tr.text}\"", "Google Translate", "🌍", 850, true) { it.openUrl(url) }
        }
        Parsers.define(t)?.let { word ->
            out += action("define", "Define $word", "Dictionary", "📖", 800, true) { it.webSearch("define $word") }
        }
        Parsers.torch(t)?.let { want ->
            if (torch.available) {
                val on = when (want) {
                    "on" -> true
                    "off" -> false
                    else -> !torch.isOn
                }
                out += action("torch", if (on) "Turn flashlight on" else "Turn flashlight off", "Flashlight", "🔦", 950, true) {
                    if (!torch.set(on)) it.toast("Flashlight unavailable")
                }
            }
        }
        return out
    }

    private fun action(
        key: String,
        title: String,
        subtitle: String?,
        emoji: String,
        score: Int,
        voiceAuto: Boolean,
        run: (Host) -> Unit,
    ) = Result(
        section = Section.ACTIONS,
        key = "action:$key",
        title = title,
        subtitle = subtitle,
        icon = glyph(emoji),
        score = score,
        voiceAuto = voiceAuto,
        onClick = run,
    )

    private fun describeDuration(seconds: Int): String {
        val h = seconds / 3600
        val m = (seconds % 3600) / 60
        val s = seconds % 60
        return listOfNotNull(
            if (h > 0) "$h h" else null,
            if (m > 0) "$m min" else null,
            if (s > 0) "$s s" else null,
        ).joinToString(" ")
    }

    companion object {
        /** Google's "Search a song" (also hum-to-search), with Shazam / SoundHound as fallbacks. */
        fun songIntent(): Intent =
            Intent("com.google.android.googlequicksearchbox.MUSIC_SEARCH")
                .setPackage("com.google.android.googlequicksearchbox")

        fun songFallbacks(context: Context? = null): Array<Intent> = listOfNotNull(
            context?.packageManager?.getLaunchIntentForPackage("com.shazam.android"),
            context?.packageManager?.getLaunchIntentForPackage("com.melodis.midomiMusicIdentifier.freemium"),
            Intent(Intent.ACTION_VIEW, Uri.parse("market://search?q=identify%20song")),
        ).toTypedArray()

        fun lensIntent(): Intent =
            Intent(Intent.ACTION_VIEW, Uri.parse("googleapp://lens")).setPackage("com.google.android.googlequicksearchbox")

        fun lensFallbacks(context: Context? = null): Array<Intent> = listOfNotNull(
            context?.packageManager?.getLaunchIntentForPackage("com.google.ar.lens"),
            Intent(Intent.ACTION_VIEW, Uri.parse("https://lens.google.com/")),
        ).toTypedArray()
    }

    private fun lensFallbacks(): Array<Intent> = lensFallbacks(context)
}
