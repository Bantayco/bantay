package dev.omnibox.launcher

import java.net.HttpURLConnection
import java.net.URL

/** Minimal blocking HTTP GET. Call from a background thread only. */
object Net {
    fun get(url: String, timeoutMs: Int = 2500): String? = try {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = timeoutMs
        connection.readTimeout = timeoutMs
        connection.setRequestProperty("User-Agent", "Omnibox/1.0 (Android)")
        connection.setRequestProperty("Accept", "application/json")
        try {
            if (connection.responseCode !in 200..299) null
            else connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            connection.disconnect()
        }
    } catch (e: Exception) {
        null
    }
}
