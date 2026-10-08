package dev.omnibox.launcher

import java.math.BigDecimal
import java.math.MathContext
import kotlin.math.abs

/** Offline unit conversion for queries like "10 km to miles", "72 f in c" or just "5 lb". */
object UnitConverter {

    enum class Category { LENGTH, MASS, VOLUME, TIME, DATA, SPEED, AREA, ENERGY, TEMPERATURE }

    class UnitDef(
        val category: Category,
        val symbol: String,
        val toBase: (Double) -> Double,
        val fromBase: (Double) -> Double,
    )

    class Conversion(val value: Double, val from: UnitDef, val to: UnitDef, val result: Double) {
        val inputText: String get() = "${formatNumber(value)} ${from.symbol}"
        val resultText: String get() = "${formatNumber(result)} ${to.symbol}"
    }

    private val units = HashMap<String, UnitDef>()
    private val bySymbol = HashMap<String, UnitDef>()

    private val DEFAULT_TARGET = mapOf(
        "km" to "mi", "mi" to "km", "m" to "ft", "ft" to "m", "cm" to "in", "in" to "cm",
        "mm" to "in", "yd" to "m", "kg" to "lb", "lb" to "kg", "g" to "oz", "oz" to "g", "st" to "kg",
        "°C" to "°F", "°F" to "°C", "K" to "°C", "L" to "gal", "gal" to "L", "mL" to "fl oz",
        "fl oz" to "mL", "cup" to "mL", "km/h" to "mph", "mph" to "km/h", "kn" to "km/h",
        "m²" to "ft²", "ft²" to "m²", "acre" to "ha", "ha" to "acre", "kcal" to "kJ", "kJ" to "kcal",
    )

    private val PATTERN = Regex(
        """^\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*(.+?)\s*(?:\s(?:to|in|into|as)\s|->|→|=)\s*(.+?)\s*$""",
        RegexOption.IGNORE_CASE,
    )
    private val SINGLE = Regex("""^\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*([^\d\s][^\d]*?)\s*$""", RegexOption.IGNORE_CASE)

    init {
        // Length (base: metre)
        linear(Category.LENGTH, "mm", 0.001, "millimeter", "millimetre")
        linear(Category.LENGTH, "cm", 0.01, "centimeter", "centimetre")
        linear(Category.LENGTH, "m", 1.0, "meter", "metre")
        linear(Category.LENGTH, "km", 1000.0, "kilometer", "kilometre", "kms")
        linear(Category.LENGTH, "in", 0.0254, "inch", "inches", "\"")
        linear(Category.LENGTH, "ft", 0.3048, "foot", "feet", "'")
        linear(Category.LENGTH, "yd", 0.9144, "yard")
        linear(Category.LENGTH, "mi", 1609.344, "mile")
        linear(Category.LENGTH, "nmi", 1852.0, "nautical mile")
        // Mass (base: kilogram)
        linear(Category.MASS, "mg", 1e-6, "milligram")
        linear(Category.MASS, "g", 1e-3, "gram", "gr")
        linear(Category.MASS, "kg", 1.0, "kilogram", "kilo", "kilos")
        linear(Category.MASS, "t", 1000.0, "tonne", "metric ton", "ton")
        linear(Category.MASS, "oz", 0.028349523125, "ounce")
        linear(Category.MASS, "lb", 0.45359237, "pound", "lbs")
        linear(Category.MASS, "st", 6.35029318, "stone")
        // Volume (base: litre)
        linear(Category.VOLUME, "mL", 0.001, "ml", "milliliter", "millilitre")
        linear(Category.VOLUME, "L", 1.0, "l", "liter", "litre")
        linear(Category.VOLUME, "tsp", 0.00492892159375, "teaspoon")
        linear(Category.VOLUME, "tbsp", 0.01478676478125, "tablespoon")
        linear(Category.VOLUME, "fl oz", 0.0295735295625, "floz", "fluid ounce")
        linear(Category.VOLUME, "cup", 0.2365882365, "cups")
        linear(Category.VOLUME, "pt", 0.473176473, "pint")
        linear(Category.VOLUME, "qt", 0.946352946, "quart")
        linear(Category.VOLUME, "gal", 3.785411784, "gallon")
        linear(Category.VOLUME, "m³", 1000.0, "m3", "cubic meter", "cubic metre")
        // Time (base: second)
        linear(Category.TIME, "ms", 0.001, "millisecond")
        linear(Category.TIME, "s", 1.0, "sec", "second")
        linear(Category.TIME, "min", 60.0, "minute", "mins")
        linear(Category.TIME, "h", 3600.0, "hr", "hour", "hrs")
        linear(Category.TIME, "day", 86400.0, "d")
        linear(Category.TIME, "week", 604800.0, "wk")
        linear(Category.TIME, "month", 2629746.0)
        linear(Category.TIME, "year", 31556952.0, "yr")
        // Digital storage (base: byte)
        linear(Category.DATA, "bit", 0.125)
        linear(Category.DATA, "B", 1.0, "b", "byte")
        linear(Category.DATA, "KB", 1e3, "kb", "kilobyte")
        linear(Category.DATA, "MB", 1e6, "mb", "megabyte")
        linear(Category.DATA, "GB", 1e9, "gb", "gigabyte")
        linear(Category.DATA, "TB", 1e12, "tb", "terabyte")
        linear(Category.DATA, "KiB", 1024.0, "kib")
        linear(Category.DATA, "MiB", 1048576.0, "mib")
        linear(Category.DATA, "GiB", 1073741824.0, "gib")
        linear(Category.DATA, "TiB", 1099511627776.0, "tib")
        // Speed (base: m/s)
        linear(Category.SPEED, "m/s", 1.0, "meters per second", "mps")
        linear(Category.SPEED, "km/h", 1 / 3.6, "kph", "kmh", "kmph", "kilometers per hour", "kilometres per hour")
        linear(Category.SPEED, "mph", 0.44704, "miles per hour")
        linear(Category.SPEED, "kn", 0.514444444, "knot", "knots", "kt")
        linear(Category.SPEED, "ft/s", 0.3048, "fps", "feet per second")
        // Area (base: m²)
        linear(Category.AREA, "m²", 1.0, "m2", "sq m", "square meter", "square metre", "sqm")
        linear(Category.AREA, "km²", 1e6, "km2", "sq km", "square kilometer", "square kilometre")
        linear(Category.AREA, "ft²", 0.09290304, "ft2", "sq ft", "square foot", "square feet", "sqft")
        linear(Category.AREA, "acre", 4046.8564224, "ac")
        linear(Category.AREA, "ha", 10000.0, "hectare")
        linear(Category.AREA, "mi²", 2589988.110336, "mi2", "sq mi", "square mile")
        // Energy (base: joule)
        linear(Category.ENERGY, "J", 1.0, "j", "joule")
        linear(Category.ENERGY, "kJ", 1000.0, "kj", "kilojoule")
        linear(Category.ENERGY, "cal", 4.184, "calorie")
        linear(Category.ENERGY, "kcal", 4184.0, "kilocalorie", "calories (food)")
        linear(Category.ENERGY, "Wh", 3600.0, "wh", "watt hour")
        linear(Category.ENERGY, "kWh", 3.6e6, "kwh", "kilowatt hour")
        // Temperature (base: Celsius)
        register(UnitDef(Category.TEMPERATURE, "°C", { it }, { it }), "c", "celsius", "centigrade", "degc")
        register(UnitDef(Category.TEMPERATURE, "°F", { (it - 32) * 5 / 9 }, { it * 9 / 5 + 32 }), "f", "fahrenheit", "degf")
        register(UnitDef(Category.TEMPERATURE, "K", { it - 273.15 }, { it + 273.15 }), "k", "kelvin")
    }

    private fun linear(category: Category, symbol: String, factor: Double, vararg names: String) {
        register(UnitDef(category, symbol, { it * factor }, { it / factor }), *names)
    }

    private fun register(unit: UnitDef, vararg names: String) {
        bySymbol[unit.symbol] = unit
        units[unit.symbol] = unit
        units[unit.symbol.lowercase()] = units[unit.symbol.lowercase()] ?: unit
        for (n in names) units[n] = unit
    }

    fun lookup(name: String): UnitDef? {
        units[name.trim()]?.let { return it }
        var n = name.trim().lowercase().replace(Regex("\\s+"), " ")
        n = n.removePrefix("degrees ").removePrefix("degree ").removePrefix("deg ").replace("°", "").trim()
        units[n]?.let { return it }
        if (n.endsWith("es")) units[n.dropLast(2)]?.let { return it }
        if (n.endsWith("s")) units[n.dropLast(1)]?.let { return it }
        return null
    }

    fun parse(query: String): Conversion? {
        PATTERN.matchEntire(query)?.let { m ->
            parseParts(m.groupValues[1], m.groupValues[2], m.groupValues[3])?.let { return it }
        }
        SINGLE.matchEntire(query)?.let { m -> return parseParts(m.groupValues[1], m.groupValues[2], "") }
        return null
    }

    private fun parseParts(valueText: String, fromText: String, toText: String): Conversion? {
        val value = valueText.toDoubleOrNull() ?: return null
        val from = lookup(fromText) ?: return null
        val to = if (toText.isBlank()) {
            DEFAULT_TARGET[from.symbol]?.let { bySymbol[it] } ?: return null
        } else {
            lookup(toText) ?: return null
        }
        if (from.category != to.category || from === to) return null
        return Conversion(value, from, to, to.fromBase(from.toBase(value)))
    }

    fun formatNumber(v: Double): String {
        if (v == 0.0) return "0"
        val bd = BigDecimal(v).round(MathContext(6)).stripTrailingZeros()
        return if (abs(v) >= 1e12 || abs(v) < 1e-6) bd.toString() else bd.toPlainString()
    }
}
