package dev.omnibox.launcher

import java.util.Locale

/** Parses currency conversions like "100 usd to eur", "€20 in dollars" or "50 gbp". */
object CurrencyParser {

    class Request(val amount: Double, val from: String, val to: String)

    /** Currencies published by the European Central Bank reference rates (served by frankfurter.app). */
    val SUPPORTED = setOf(
        "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS",
        "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB",
        "TRY", "USD", "ZAR",
    )

    private val ALIASES = mapOf(
        "$" to "USD", "us$" to "USD", "dollar" to "USD", "dollars" to "USD", "bucks" to "USD",
        "€" to "EUR", "euro" to "EUR", "euros" to "EUR",
        "£" to "GBP", "pound" to "GBP", "pounds" to "GBP", "quid" to "GBP",
        "¥" to "JPY", "yen" to "JPY", "₹" to "INR", "rupee" to "INR", "rupees" to "INR",
        "₩" to "KRW", "won" to "KRW", "₱" to "PHP", "₺" to "TRY", "₪" to "ILS", "฿" to "THB",
        "yuan" to "CNY", "rmb" to "CNY", "franc" to "CHF", "francs" to "CHF", "peso" to "MXN", "pesos" to "MXN",
        "c$" to "CAD", "a$" to "AUD", "r$" to "BRL", "real" to "BRL", "reais" to "BRL", "rand" to "ZAR",
    )

    private const val UNIT = """(?:[a-z]{3}|[a-z]\$|us\$|[$€£¥₹₩₱₺₪฿]|dollars?|bucks|euros?|pounds?|quid|yen|rupees?|won|yuan|rmb|francs?|pesos?|real|reais|rand)"""
    private val PATTERN = Regex(
        """^\s*($UNIT)?\s*(\d+(?:[.,]\d+)?)\s*($UNIT)?\s*(?:(?:to|in|into|=|->)\s*($UNIT))?\s*$""",
        RegexOption.IGNORE_CASE,
    )

    fun resolve(token: String): String? {
        val t = token.trim().lowercase(Locale.ROOT)
        if (t.isEmpty()) return null
        ALIASES[t]?.let { return it }
        val upper = t.uppercase(Locale.ROOT)
        return upper.takeIf { it in SUPPORTED }
    }

    fun parse(text: String, localCurrency: String?): Request? {
        val m = PATTERN.matchEntire(text) ?: return null
        val prefix = m.groupValues[1]
        val suffix = m.groupValues[3]
        if (prefix.isNotEmpty() && suffix.isNotEmpty()) return null
        val fromToken = prefix.ifEmpty { suffix }
        if (fromToken.isEmpty()) return null
        val from = resolve(fromToken) ?: return null
        val amount = m.groupValues[2].replace(',', '.').toDoubleOrNull() ?: return null
        val to = if (m.groupValues[4].isNotEmpty()) {
            resolve(m.groupValues[4]) ?: return null
        } else {
            val local = localCurrency?.takeIf { it in SUPPORTED && it != from }
            local ?: if (from == "USD") "EUR" else "USD"
        }
        if (from == to) return null
        return Request(amount, from, to)
    }
}
