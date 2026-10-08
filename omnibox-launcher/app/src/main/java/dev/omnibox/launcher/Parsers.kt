package dev.omnibox.launcher

import java.util.Locale

/** Pure parsing for the omnibox's "smart" commands. No Android dependencies, so it is unit-tested. */
object Parsers {

    class UrlMatch(val url: String, val confident: Boolean)

    class Translate(val text: String, val languageCode: String?)

    class Dice(val count: Int, val sides: Int)

    private val URL = Regex(
        """^(?:(https?|ftp)://)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}|localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d{1,5})?([/?#]\S*)?$""",
        RegexOption.IGNORE_CASE,
    )
    private val COMMON_TLDS = setOf(
        "com", "org", "net", "edu", "gov", "io", "dev", "app", "co", "ai", "me", "info", "biz", "tv",
        "uk", "us", "ca", "de", "fr", "es", "it", "nl", "jp", "cn", "in", "au", "br", "ru", "ch", "se",
        "no", "fi", "dk", "pl", "be", "at", "nz", "mx", "kr", "ph", "sg", "ie", "xyz", "online", "site",
    )

    fun url(text: String): UrlMatch? {
        val t = text.trim()
        if (t.isEmpty() || t.any { it.isWhitespace() }) return null
        val m = URL.matchEntire(t) ?: return null
        val scheme = m.groupValues[1]
        val host = m.groupValues[2].lowercase()
        val hasPath = m.groupValues[4].isNotEmpty() || m.groupValues[3].isNotEmpty()
        val tld = host.substringAfterLast('.')
        val confident = scheme.isNotEmpty() || host.startsWith("www.") || hasPath || tld in COMMON_TLDS ||
            host == "localhost" || host.first().isDigit()
        val full = if (scheme.isEmpty()) "https://$t" else t
        return UrlMatch(full, confident)
    }

    private val PHONE = Regex("""^\+?[\d\s\-().]{5,22}$""")

    fun phone(text: String): String? {
        val t = text.trim()
        if (!PHONE.matches(t)) return null
        val digits = t.count { it.isDigit() }
        if (digits < 5 || digits > 15) return null
        if (t.contains('.') && !t.contains(' ') && !t.contains('-')) return null // looks like a decimal
        return t
    }

    private val EMAIL = Regex("""^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$""")

    fun email(text: String): String? = text.trim().takeIf { EMAIL.matches(it) }

    private val DURATION_PART = Regex(
        """(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b""",
    )
    private val TIMER_FORMS = listOf(
        Regex("""^(?:set (?:a |the )?)?timer (?:for )?(.+)$"""),
        Regex("""^(?:start (?:a )?)?(?:countdown|count down) (?:for )?(.+)$"""),
        Regex("""^(.+?) timer$"""),
    )

    /** "set a timer for 5 minutes", "timer 1h 30m", "10 min timer" → seconds. */
    fun timerSeconds(text: String): Int? {
        val t = text.trim().lowercase(Locale.ROOT)
        for (form in TIMER_FORMS) {
            val m = form.matchEntire(t) ?: continue
            return duration(m.groupValues[1].replace('-', ' '))
        }
        return null
    }

    fun duration(text: String): Int? {
        var total = 0.0
        var found = false
        val rest = DURATION_PART.replace(text) { m ->
            found = true
            val n = m.groupValues[1].toDouble()
            total += when (m.groupValues[2].first()) {
                'h' -> n * 3600
                'm' -> n * 60
                else -> n
            }
            " "
        }
        if (!found) return null
        if (rest.replace("and", " ").replace(",", " ").isNotBlank()) return null
        val seconds = total.toInt()
        return if (seconds in 1..86400) seconds else null
    }

    private val ALARM_FORMS = listOf(
        Regex("""^(?:set (?:an |the )?)?alarm (?:for |at )?(.+)$"""),
        Regex("""^wake me(?: up)? (?:at )?(.+)$"""),
    )
    private val CLOCK_TIME = Regex("""^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$""")

    /** "alarm 7am", "set an alarm for 6:30 pm", "wake me up at 7" → (hour24, minute). */
    fun alarmTime(text: String): Pair<Int, Int>? {
        val t = text.trim().lowercase(Locale.ROOT)
        for (form in ALARM_FORMS) {
            val m = form.matchEntire(t) ?: continue
            return clockTime(m.groupValues[1].trim())
        }
        return null
    }

    fun clockTime(text: String): Pair<Int, Int>? {
        val m = CLOCK_TIME.matchEntire(text.trim()) ?: return null
        var hour = m.groupValues[1].toInt()
        val minute = m.groupValues[2].ifEmpty { "0" }.toInt()
        val meridiem = m.groupValues[3]
        if (minute > 59) return null
        if (meridiem.isNotEmpty()) {
            if (hour !in 1..12) return null
            val pm = meridiem.startsWith("p")
            hour = when {
                pm && hour != 12 -> hour + 12
                !pm && hour == 12 -> 0
                else -> hour
            }
        } else if (hour > 23) {
            return null
        }
        return hour to minute
    }

    private fun firstGroup(text: String, vararg forms: Regex): String? {
        val t = text.trim()
        for (form in forms) {
            val m = form.matchEntire(t) ?: continue
            return m.groupValues[1].trim().takeIf { it.isNotEmpty() }
        }
        return null
    }

    private val NAVIGATE = Regex(
        """^(?:navigate to|navigate|directions to|get directions to|take me to|drive to|walk to|route to|how do i get to) (.+)$""",
        RegexOption.IGNORE_CASE,
    )
    private val NEAR_ME = Regex("""^(.+?) (?:near me|nearby|around me|close to me)$""", RegexOption.IGNORE_CASE)
    private val EVENT = Regex(
        """^(?:remind me to|remind me|add event|create event|new event|schedule|add to calendar|calendar) (.+)$""",
        RegexOption.IGNORE_CASE,
    )
    private val PLAY = Regex("""^(?:play|listen to) (.+)$""", RegexOption.IGNORE_CASE)
    private val DEFINE = Regex(
        """^(?:define|definition of|meaning of|what is the meaning of|what's the meaning of) (.+?)\??$""",
        RegexOption.IGNORE_CASE,
    )
    private val WHAT_DOES_MEAN = Regex("""^what does (.+) mean\??$""", RegexOption.IGNORE_CASE)
    private val TRANSLATE = Regex("""^translate (.+?)(?: (?:to|into) ([a-z ]+))?$""", RegexOption.IGNORE_CASE)
    private val SAY_IN = Regex("""^how (?:do you|to) say (.+) in ([a-z ]+)$""", RegexOption.IGNORE_CASE)

    fun navigateTo(text: String): String? = firstGroup(text, NAVIGATE)
    fun nearMe(text: String): String? = firstGroup(text, NEAR_ME)
    fun calendarEvent(text: String): String? = firstGroup(text, EVENT)
    fun play(text: String): String? = firstGroup(text, PLAY)

    fun define(text: String): String? = firstGroup(text, DEFINE, WHAT_DOES_MEAN)

    fun translate(text: String): Translate? {
        val t = text.trim()
        SAY_IN.matchEntire(t)?.let { m ->
            return Translate(m.groupValues[1].trim(), languageCode(m.groupValues[2]))
        }
        val m = TRANSLATE.matchEntire(t) ?: return null
        val lang = m.groupValues[2].trim()
        val code = if (lang.isEmpty()) null else languageCode(lang)
        // "translate good morning to" etc: if the language is unknown, keep the words as text.
        val phrase = if (lang.isNotEmpty() && code == null) "${m.groupValues[1]} to $lang" else m.groupValues[1]
        return Translate(phrase.trim(), code)
    }

    fun languageCode(name: String): String? {
        val n = name.trim().lowercase(Locale.ROOT)
        if (n.isEmpty()) return null
        for (locale in Locale.getAvailableLocales()) {
            if (locale.getDisplayLanguage(Locale.ENGLISH).lowercase(Locale.ROOT) == n) return locale.language
        }
        return null
    }

    private val COIN = Regex("""^(?:flip|toss) (?:a )?coin$|^heads or tails\??$""", RegexOption.IGNORE_CASE)
    private val DICE = Regex("""^roll (?:a |an )?(?:(\d+) ?)?(?:dice|die|d(\d+))$""", RegexOption.IGNORE_CASE)
    private val RANDOM = Regex(
        """^(?:random number|pick a number|random)(?: (?:between|from) (-?\d+) (?:and|to) (-?\d+))?$""",
        RegexOption.IGNORE_CASE,
    )

    fun coinFlip(text: String): Boolean = COIN.matches(text.trim())

    fun dice(text: String): Dice? {
        val m = DICE.matchEntire(text.trim()) ?: return null
        val count = m.groupValues[1].ifEmpty { "1" }.toInt()
        val sides = m.groupValues[2].ifEmpty { "6" }.toInt()
        if (count !in 1..20 || sides !in 2..1000) return null
        return Dice(count, sides)
    }

    fun randomRange(text: String): Pair<Long, Long>? {
        val m = RANDOM.matchEntire(text.trim()) ?: return null
        if (m.groupValues[1].isEmpty()) return 1L to 100L
        val a = m.groupValues[1].toLong()
        val b = m.groupValues[2].toLong()
        return minOf(a, b) to maxOf(a, b)
    }

    private val TORCH = Regex(
        """^(?:turn |switch )?(?:(on|off) )?(?:the )?(?:flashlight|torch|flash light)(?: (on|off))?$""",
        RegexOption.IGNORE_CASE,
    )

    /** Returns null when not a torch command, otherwise the desired state ("on"/"off"/"toggle"). */
    fun torch(text: String): String? {
        val m = TORCH.matchEntire(text.trim()) ?: return null
        return m.groupValues[1].ifEmpty { m.groupValues[2] }.lowercase(Locale.ROOT).ifEmpty { "toggle" }
    }
}
