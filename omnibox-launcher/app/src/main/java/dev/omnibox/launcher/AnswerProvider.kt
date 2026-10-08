package dev.omnibox.launcher

import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.random.Random

/** Instant offline answers: calculator, unit conversion, world clock, coin / dice / random numbers. */
class AnswerProvider : Provider {
    override val id = "answers"

    override fun query(q: Query): List<Result> {
        if (q.isEmpty) return emptyList()
        val out = ArrayList<Result>()
        calculator(q)?.let { out += it }
        units(q)?.let { out += it }
        time(q)?.let { out += it }
        chance(q)?.let { out += it }
        return out
    }

    private fun calculator(q: Query): Result? {
        if (!Calculator.looksLikeMath(q.text)) return null
        val value = Calculator.evaluate(q.text) ?: return null
        val text = Calculator.format(value)
        return answer("calc", text, Calculator.normalize(q.text) + " =", "🧮", text)
    }

    private fun units(q: Query): Result? {
        val c = UnitConverter.parse(q.text) ?: return null
        return answer("units", c.resultText, c.inputText + " =", "📏", UnitConverter.formatNumber(c.result))
    }

    private fun time(q: Query): Result? {
        val zone = TimeZones.parse(q.text) ?: return null
        val now = ZonedDateTime.now(zone)
        val time = now.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(Locale.getDefault()))
        val date = now.format(DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.getDefault()))
        val place = if (zone == ZoneId.systemDefault()) "Local time" else "Time in ${TimeZones.cityName(zone)}"
        val offset = now.offset.id.let { if (it == "Z") "UTC" else "UTC$it" }
        return answer("time", time, "$place · $date · $offset", "🕐", null)
    }

    private fun chance(q: Query): Result? {
        if (Parsers.coinFlip(q.text)) {
            val heads = Random.nextBoolean()
            return answer("coin", if (heads) "Heads" else "Tails", "Coin flip — tap to flip again", "🪙", null, reroll = true)
        }
        Parsers.dice(q.text)?.let { d ->
            val rolls = List(d.count) { Random.nextInt(1, d.sides + 1) }
            val title = if (rolls.size == 1) rolls[0].toString() else "${rolls.sum()}  (${rolls.joinToString(" + ")})"
            return answer("dice", title, "Rolled ${d.count}d${d.sides} — tap to roll again", "🎲", null, reroll = true)
        }
        Parsers.randomRange(q.text)?.let { (lo, hi) ->
            val n = Random.nextLong(lo, hi + 1)
            return answer("random", n.toString(), "Random number between $lo and $hi — tap for another", "🎲", null, reroll = true)
        }
        return null
    }

    private fun answer(
        key: String,
        title: String,
        subtitle: String,
        emoji: String,
        copyText: String?,
        reroll: Boolean = false,
    ) = Result(
        section = Section.ANSWER,
        key = "answer:$key",
        title = title,
        subtitle = subtitle,
        icon = glyph(emoji),
        score = 1000,
        style = Result.Style.ANSWER,
        fill = copyText,
        onClick = { host ->
            when {
                reroll -> host.refresh()
                copyText != null -> host.copyToClipboard(copyText)
                else -> host.copyToClipboard(title)
            }
        },
    )
}
