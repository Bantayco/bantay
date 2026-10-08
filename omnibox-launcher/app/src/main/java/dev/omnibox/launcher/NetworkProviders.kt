package dev.omnibox.launcher

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.function.Consumer
import kotlin.math.roundToInt

/** Live query suggestions from the selected search engine. */
class SuggestProvider(private val context: Context, private val prefs: Prefs) : Provider {
    override val id = "suggest"
    override val network = true

    override fun query(q: Query): List<Result> {
        if (q.isEmpty || !prefs.webSuggestions) return emptyList()
        val url = prefs.engine.suggestUrl(q.text) ?: return emptyList()
        val body = Net.get(url) ?: return emptyList()
        val suggestions = try {
            val arr = JSONArray(body).getJSONArray(1)
            List(arr.length()) { arr.optString(it) }
        } catch (e: Exception) {
            emptyList()
        }
        return suggestions
            .filter { it.isNotBlank() && !it.equals(q.text, ignoreCase = true) }
            .distinct()
            .take(MAX)
            .mapIndexed { i, s ->
                Result(
                    section = Section.SUGGEST,
                    key = "suggest:$s",
                    title = s,
                    icon = context.tintedIcon(R.drawable.ic_search),
                    score = 100 - i,
                    fill = s,
                    onClick = { host -> host.webSearch(s) },
                )
            }
    }

    companion object {
        private const val MAX = 6
    }
}

/** Live currency conversion using European Central Bank reference rates (frankfurter.app, no API key). */
class CurrencyProvider : Provider {
    override val id = "currency"
    override val network = true

    private class Rates(val fetchedAt: Long, val date: String, val rates: Map<String, Double>)

    private val cache = ConcurrentHashMap<String, Rates>()

    override fun query(q: Query): List<Result> {
        if (q.isEmpty) return emptyList()
        val local = try {
            Currency.getInstance(Locale.getDefault()).currencyCode
        } catch (e: Exception) {
            null
        }
        val req = CurrencyParser.parse(q.text, local) ?: return emptyList()
        val rates = rates(req.from) ?: return emptyList()
        val rate = rates.rates[req.to] ?: return emptyList()
        val converted = req.amount * rate
        val fmt = NumberFormat.getNumberInstance().apply {
            minimumFractionDigits = 2
            maximumFractionDigits = if (converted < 1) 4 else 2
        }
        val toName = displayName(req.to)
        val fromName = displayName(req.from)
        val title = "${fmt.format(converted)} $toName"
        return listOf(
            Result(
                section = Section.ANSWER,
                key = "answer:currency",
                title = title,
                subtitle = "${fmt.format(req.amount)} $fromName = · ECB rate ${rates.date}",
                icon = glyph("💱"),
                score = 1000,
                style = Result.Style.ANSWER,
                fill = fmt.format(converted),
                onClick = { host -> host.copyToClipboard(fmt.format(converted)) },
            ),
        )
    }

    private fun displayName(code: String): String = try {
        Currency.getInstance(code).getDisplayName(Locale.getDefault())
    } catch (e: Exception) {
        code
    }

    private fun rates(base: String): Rates? {
        cache[base]?.let { if (System.currentTimeMillis() - it.fetchedAt < CACHE_MS) return it }
        val body = Net.get("https://api.frankfurter.app/latest?from=$base") ?: return null
        return try {
            val json = JSONObject(body)
            val obj = json.getJSONObject("rates")
            val map = HashMap<String, Double>()
            for (k in obj.keys()) map[k] = obj.getDouble(k)
            Rates(System.currentTimeMillis(), json.optString("date"), map).also { cache[base] = it }
        } catch (e: Exception) {
            null
        }
    }

    companion object {
        private const val CACHE_MS = 60 * 60 * 1000L
    }
}

/** "weather", "weather in paris", "tokyo weather": current conditions from Open-Meteo (no API key). */
class WeatherProvider(private val context: Context, private val prefs: Prefs) : Provider {
    override val id = "weather"
    override val network = true

    private val forms = listOf(
        Regex("""^(?:weather|forecast|temperature|temp)(?: (?:today|now|tomorrow|this week))?(?: (?:in|at|for) (.+?))?(?: (?:today|now|tomorrow))?\??$"""),
        Regex("""^(?:what's|what is|how's|how is) the weather(?: (?:like )?(?:in|at) (.+?))?(?: today| now)?\??$"""),
        Regex("""^(.+?) (?:weather|forecast)$"""),
        Regex("""^is it (?:going to )?rain(?:ing)?(?: (?:in|at) (.+?))?(?: today)?\??$"""),
    )

    private class Place(val name: String, val lat: Double, val lon: Double)

    override fun query(q: Query): List<Result> {
        if (q.isEmpty || !prefs.weatherEnabled) return emptyList()
        var matched = false
        var placeName = ""
        for (form in forms) {
            val m = form.matchEntire(q.lower) ?: continue
            matched = true
            placeName = m.groupValues[1].trim()
            break
        }
        if (!matched) return emptyList()

        val place = (
            if (placeName.isNotEmpty()) {
                geocode(placeName)
            } else {
                if (!hasLocationPermission()) return listOf(permissionRow())
                currentLocation()?.let { Place("Your location", it.latitude, it.longitude) }
            }
            ) ?: return emptyList()

        return forecast(place)?.let { listOf(it) } ?: emptyList()
    }

    private fun hasLocationPermission() =
        context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun permissionRow() = Result(
        section = Section.ANSWER,
        key = "answer:weather-permission",
        title = "Allow location for local weather",
        subtitle = "Or search \"weather in <city>\"",
        icon = glyph("⛅"),
        score = 900,
        onClick = { host -> host.requestPermission(Manifest.permission.ACCESS_COARSE_LOCATION) },
    )

    @SuppressLint("MissingPermission")
    private fun currentLocation(): Location? {
        if (!hasLocationPermission()) return null
        val lm = context.getSystemService(LocationManager::class.java) ?: return null
        val providers = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER, LocationManager.PASSIVE_PROVIDER)
        val last = providers.mapNotNull { p ->
            try {
                lm.getLastKnownLocation(p)
            } catch (e: Exception) {
                null
            }
        }.maxByOrNull { it.time }
        if (last != null && System.currentTimeMillis() - last.time < 3 * 60 * 60 * 1000L) return last
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val provider = providers.firstOrNull { p ->
                p != LocationManager.PASSIVE_PROVIDER && try {
                    lm.isProviderEnabled(p)
                } catch (e: Exception) {
                    false
                }
            }
            if (provider != null) {
                val latch = CountDownLatch(1)
                var fresh: Location? = null
                val executor = Executors.newSingleThreadExecutor()
                try {
                    lm.getCurrentLocation(provider, null, executor, Consumer { loc ->
                        fresh = loc
                        latch.countDown()
                    })
                    latch.await(4, TimeUnit.SECONDS)
                } catch (e: Exception) {
                    // Fall through to the last known location.
                } finally {
                    executor.shutdown()
                }
                fresh?.let { return it }
            }
        }
        return last
    }

    private fun geocode(name: String): Place? {
        val body = Net.get(
            "https://geocoding-api.open-meteo.com/v1/search?count=1&language=" +
                Locale.getDefault().language + "&name=" + Uri.encode(name),
        ) ?: return null
        return try {
            val r = JSONObject(body).getJSONArray("results").getJSONObject(0)
            val label = listOf(r.optString("name"), r.optString("admin1"), r.optString("country"))
                .filter { it.isNotEmpty() }.distinct().joinToString(", ")
            Place(label, r.getDouble("latitude"), r.getDouble("longitude"))
        } catch (e: Exception) {
            null
        }
    }

    private fun forecast(place: Place): Result? {
        val imperial = Locale.getDefault().country in setOf("US", "LR", "MM", "BS", "BZ", "KY", "PW")
        val url = "https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}" +
            "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
            "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto" +
            if (imperial) "&temperature_unit=fahrenheit&wind_speed_unit=mph" else ""
        val body = Net.get(url) ?: return null
        return try {
            val json = JSONObject(body)
            val cur = json.getJSONObject("current")
            val daily = json.getJSONObject("daily")
            val temp = cur.getDouble("temperature_2m").roundToInt()
            val feels = cur.getDouble("apparent_temperature").roundToInt()
            val humidity = cur.optInt("relative_humidity_2m")
            val wind = cur.getDouble("wind_speed_10m").roundToInt()
            val (desc, emoji) = describe(cur.getInt("weather_code"))
            val hi = daily.getJSONArray("temperature_2m_max").getDouble(0).roundToInt()
            val lo = daily.getJSONArray("temperature_2m_min").getDouble(0).roundToInt()
            val rain = daily.optJSONArray("precipitation_probability_max")?.optInt(0)
            val windUnit = if (imperial) "mph" else "km/h"
            val unit = if (imperial) "°F" else "°C"
            Result(
                section = Section.ANSWER,
                key = "answer:weather",
                title = "$temp$unit  $desc",
                subtitle = buildString {
                    append(place.name)
                    append(" · H $hi° L $lo° · Feels $feels°")
                    if (rain != null) append(" · Rain $rain%")
                    append(" · Humidity $humidity% · Wind $wind $windUnit")
                },
                icon = glyph(emoji),
                score = 1000,
                style = Result.Style.ANSWER,
                onClick = { host ->
                    host.webSearch(if (place.name == "Your location") "weather" else "weather ${place.name}")
                },
            )
        } catch (e: Exception) {
            null
        }
    }

    private fun describe(code: Int): Pair<String, String> = when (code) {
        0 -> "Clear" to "☀️"
        1 -> "Mostly clear" to "🌤️"
        2 -> "Partly cloudy" to "⛅"
        3 -> "Cloudy" to "☁️"
        45, 48 -> "Fog" to "🌫️"
        in 51..57 -> "Drizzle" to "🌦️"
        in 61..67 -> "Rain" to "🌧️"
        in 71..77 -> "Snow" to "❄️"
        in 80..82 -> "Showers" to "🌦️"
        85, 86 -> "Snow showers" to "🌨️"
        in 95..99 -> "Thunderstorm" to "⛈️"
        else -> "—" to "🌡️"
    }
}
