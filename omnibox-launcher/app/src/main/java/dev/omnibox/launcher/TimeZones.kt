package dev.omnibox.launcher

import java.time.ZoneId
import java.util.Locale

/** Resolves "time in tokyo", "london time", "pst" style queries to a zone. */
object TimeZones {

    private val ALIASES = mapOf(
        "nyc" to "America/New_York", "new york" to "America/New_York", "ny" to "America/New_York",
        "la" to "America/Los_Angeles", "san francisco" to "America/Los_Angeles", "sf" to "America/Los_Angeles",
        "seattle" to "America/Los_Angeles", "california" to "America/Los_Angeles",
        "boston" to "America/New_York", "miami" to "America/New_York", "washington" to "America/New_York",
        "dc" to "America/New_York", "atlanta" to "America/New_York", "texas" to "America/Chicago",
        "dallas" to "America/Chicago", "houston" to "America/Chicago", "austin" to "America/Chicago",
        "pst" to "America/Los_Angeles", "pdt" to "America/Los_Angeles", "pacific" to "America/Los_Angeles",
        "est" to "America/New_York", "edt" to "America/New_York", "eastern" to "America/New_York",
        "cst" to "America/Chicago", "cdt" to "America/Chicago", "central" to "America/Chicago",
        "mst" to "America/Denver", "mdt" to "America/Denver", "mountain" to "America/Denver",
        "utc" to "UTC", "gmt" to "GMT", "uk" to "Europe/London", "england" to "Europe/London",
        "india" to "Asia/Kolkata", "delhi" to "Asia/Kolkata", "new delhi" to "Asia/Kolkata",
        "mumbai" to "Asia/Kolkata", "bangalore" to "Asia/Kolkata", "bengaluru" to "Asia/Kolkata", "ist" to "Asia/Kolkata",
        "japan" to "Asia/Tokyo", "china" to "Asia/Shanghai", "beijing" to "Asia/Shanghai",
        "korea" to "Asia/Seoul", "south korea" to "Asia/Seoul", "philippines" to "Asia/Manila",
        "germany" to "Europe/Berlin", "france" to "Europe/Paris", "spain" to "Europe/Madrid",
        "italy" to "Europe/Rome", "australia" to "Australia/Sydney", "brazil" to "America/Sao_Paulo",
        "sao paulo" to "America/Sao_Paulo", "uae" to "Asia/Dubai", "hawaii" to "Pacific/Honolulu",
        "vietnam" to "Asia/Ho_Chi_Minh", "hanoi" to "Asia/Bangkok", "canada" to "America/Toronto",
        "mexico" to "America/Mexico_City", "russia" to "Europe/Moscow", "singapore" to "Asia/Singapore",
    )

    /** Forms whose place group may be empty, meaning "local time". */
    private val LOCAL_OK = listOf(
        Regex("""^(?:what(?:'s| is) the )?(?:current |local )?time(?: now)?(?: (?:in|at) (.+?))?(?: now| right now)?\??$"""),
        Regex("""^what time is it(?: (?:in|at) (.+?))?(?: now| right now)?\??$"""),
    )
    private val PLACE_TIME = Regex("""^(.+?) (?:time|time now|local time|current time)$""")

    /** Returns the matching zone, ZoneId.systemDefault() for a bare "time", or null when not a time query. */
    fun parse(text: String): ZoneId? {
        val t = text.trim().lowercase(Locale.ROOT)
        for (form in LOCAL_OK) {
            val m = form.matchEntire(t) ?: continue
            val place = m.groupValues[1].trim()
            return if (place.isEmpty()) ZoneId.systemDefault() else find(place)
        }
        val m = PLACE_TIME.matchEntire(t) ?: return null
        return find(m.groupValues[1])
    }

    fun find(place: String): ZoneId? {
        val p = place.trim().lowercase(Locale.ROOT)
        ALIASES[p]?.let { return ZoneId.of(it) }
        val key = p.replace(' ', '_')
        val id = ZoneId.getAvailableZoneIds().firstOrNull { it.substringAfterLast('/').lowercase(Locale.ROOT) == key }
        return id?.let { ZoneId.of(it) }
    }

    /** "Tokyo" from "Asia/Tokyo", "New York" from "America/New_York". */
    fun cityName(zone: ZoneId): String = zone.id.substringAfterLast('/').replace('_', ' ')
}
